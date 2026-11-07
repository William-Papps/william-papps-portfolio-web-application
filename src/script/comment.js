import { firebaseConfig } from "../firebase/config.js";

// Initialize Firebase
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    console.log("✓ Firebase initialized successfully");
  } else {
    console.log("✓ Firebase already initialized");
  }
} catch (error) {
  console.error("✗ Failed to initialize Firebase:", error);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Document Loaded");

  // Browser Compatibility Checks
  if (!("indexedDB" in window)) {
    alert(
      "This browser does not support offline storage. Some features may not work properly.",
    );
  }

  if (!("Promise" in window)) {
    alert(
      "This browser is outdated and may not work correctly. Please update your browser.",
    );
    return;
  }

  // Firebase Initialization Check
  if (!firebase || !firebase.apps.length) {
    console.error("Firebase not initialized");
    const loadingPage = document.getElementById("loading-page");
    if (loadingPage) {
      loadingPage.innerHTML =
        "<h2>Error: Failed to initialize Firebase</h2><p>Please refresh the page or contact support.</p>";
    }
    return;
  } else {
    console.log("Firebase initialized successfully");
  }

  // Firebase Services with error handling
  let auth, database;
  try {
    auth = firebase.auth();
    database = firebase.database();
  } catch (error) {
    console.error("Failed to initialize Firebase services:", error);
    alert("Failed to initialize app. Please refresh the page.");
    return;
  }

  // Set Persistence to LOCAL to keep user logged in after refresh
  auth
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
      console.log("Firebase Auth persistence set to LOCAL");
    })
    .catch((error) => {
      console.error("Error setting persistence:", error);
      // Non-critical error, continue with app
    });

  // UI Elements
  const loadingPage = document.getElementById("loading-page");
  const loginPage = document.getElementById("login-page");
  const chatPage = document.getElementById("chat-page");
  const loginButton = document.getElementById("login-button");
  const logoutButton = document.getElementById("logout-button");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const messagesDiv = document.getElementById("messages");
  const profileIcon = document.getElementById("profile-icon");
  const profileName = document.getElementById("profile-name");
  const onlineUsersList = document.getElementById("online-users-list");
  const typingIndicator = document.getElementById("typing-indicator");

  let typingTimeout;

  // Validation and Rate Limiting Constants
  const MESSAGE_MIN_LENGTH = 1;
  const MESSAGE_MAX_LENGTH = 1000;
  const RATE_LIMIT_MESSAGES = 5; // Max messages
  const RATE_LIMIT_WINDOW = 10000; // In 10 seconds (milliseconds)
  const RATE_LIMIT_COOLDOWN = 5000; // 5 second cooldown after rate limit hit

  // Rate Limiting State
  let messageSentTimes = [];
  let isRateLimited = false;

  // Pagination Constants and State
  const MESSAGES_PER_PAGE = 50;
  const MESSAGES_LOAD_MORE = 20;
  let oldestMessageTimestamp = null;
  let oldestMessageKey = null;
  let hasMoreMessages = true;
  let isLoadingMoreMessages = false;
  let initialMessagesLoaded = false;

  // Error Handling State
  let isOnline = navigator.onLine;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 2000;
  let databaseConnectionRef = null;

  // Error Handler Utility
  function handleError(error, context, userMessage = null, showToUser = true) {
    console.error(`[${context}] Error:`, error);

    const errorDetails = {
      context,
      code: error.code || "UNKNOWN",
      message: error.message,
      timestamp: new Date().toISOString(),
    };

    // Log to console for debugging
    console.error("Error Details:", errorDetails);

    // Show user-friendly message
    if (showToUser) {
      const friendlyMessage =
        userMessage || getUserFriendlyErrorMessage(error, context);
      showNotification(friendlyMessage, "error");
    }

    return errorDetails;
  }

  function getUserFriendlyErrorMessage(error, context) {
    // Firebase Auth Errors
    if (error.code) {
      switch (error.code) {
        case "auth/popup-closed-by-user":
          return "Login cancelled. Please try again.";
        case "auth/popup-blocked":
          return "Please enable popups for this site to login.";
        case "auth/network-request-failed":
          return "Network error. Please check your connection.";
        case "auth/too-many-requests":
          return "Too many attempts. Please try again later.";
        case "auth/user-disabled":
          return "This account has been disabled.";
        case "permission-denied":
        case "PERMISSION_DENIED":
          return "Permission denied. Please login again.";
        case "disconnected":
          return "Lost connection to server. Reconnecting...";
        default:
          break;
      }
    }

    // Context-specific messages
    switch (context) {
      case "send-message":
        return "Failed to send message. Please try again.";
      case "login":
        return "Login failed. Please try again.";
      case "logout":
        return "Logout failed. Please refresh the page.";
      case "load-messages":
        return "Failed to load messages. Please refresh the page.";
      case "network":
        return "You are offline. Some features may not work.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  function showNotification(message, type = "info", duration = 5000) {
    const notificationContainer = document.getElementById(
      "notification-container",
    );
    if (!notificationContainer) return;

    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
        `;

    notificationContainer.appendChild(notification);

    // Auto-remove after duration
    setTimeout(() => {
      if (notification.parentElement) {
        notification.classList.add("fade-out");
        setTimeout(() => notification.remove(), 300);
      }
    }, duration);
  }

  // Network Connectivity Monitoring
  function setupNetworkMonitoring() {
    window.addEventListener("online", () => {
      console.log("Network: Online");
      isOnline = true;
      showNotification("Connection restored", "success", 3000);
      reconnectAttempts = 0;

      // Reconnect to Firebase
      if (auth.currentUser) {
        reconnectToFirebase();
      }
    });

    window.addEventListener("offline", () => {
      console.log("Network: Offline");
      isOnline = false;
      showNotification("You are offline", "warning");
      sendButton.disabled = true;
    });

    // Monitor Firebase connection
    if (database) {
      databaseConnectionRef = database.ref(".info/connected");
      databaseConnectionRef.on("value", (snapshot) => {
        if (snapshot.val() === true) {
          console.log("Firebase: Connected");
        } else {
          console.log("Firebase: Disconnected");
          if (isOnline) {
            showNotification("Connection lost. Reconnecting...", "warning");
          }
        }
      });
    }
  }

  function reconnectToFirebase() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      showNotification(
        "Failed to reconnect. Please refresh the page.",
        "error",
      );
      return;
    }

    reconnectAttempts++;
    console.log(
      `Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
    );

    setTimeout(() => {
      try {
        database.goOnline();
        sendButton.disabled = false;
      } catch (error) {
        handleError(error, "reconnect", null, false);
        reconnectToFirebase();
      }
    }, RECONNECT_DELAY * reconnectAttempts);
  }

  // Retry Logic for Database Operations
  async function retryOperation(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        console.log(`Attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }

  // Initialize error handling
  setupNetworkMonitoring();

  // Global error handler
  window.addEventListener("error", (event) => {
    console.error("Global error:", event.error);
    handleError(event.error, "global", "An unexpected error occurred", false);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
    handleError(event.reason, "promise", null, false);
  });

  // Authentication State Listener
  auth.onAuthStateChanged((user) => {
    loadingPage.classList.add("hidden"); // Hide loading page after checking auth state

    if (user) {
      console.log("User is logged in:", user);
      setUpChatPage(user);
    } else {
      console.log("User is logged out");
      loginPage.classList.remove("hidden");
      chatPage.classList.add("hidden");
    }
  });

  // Sign In with Google
  loginButton.addEventListener("click", async () => {
    console.log("Login Button Clicked");

    if (!isOnline) {
      showNotification("Cannot login while offline", "error");
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await retryOperation(
        () => auth.signInWithPopup(provider),
        2,
        1000,
      );
      console.log("User signed in:", result.user);
      showNotification("Login successful!", "success", 2000);
    } catch (error) {
      handleError(error, "login");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Login with Google";
    }
  });

  // Set Up Chat Page
  async function setUpChatPage(user) {
    console.log("Setting up Chat Page");

    try {
      // Hide login and loading pages, and show chat page
      loadingPage.classList.add("hidden");
      loginPage.classList.add("hidden");
      chatPage.classList.remove("hidden");

      profileIcon.src = user.photoURL || "default-avatar.png";
      profileName.textContent = user.displayName;

      // Handle profile icon load error
      profileIcon.onerror = () => {
        console.warn("Failed to load profile image, using fallback");
        profileIcon.src =
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%236B7280"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
      };

      const userStatusRef = database.ref(`onlineUsers/${user.uid}`);
      const userTypingRef = database.ref(`typing/${user.uid}`);

      try {
        await userStatusRef.set({
          displayName: user.displayName,
          online: true,
        });
        userStatusRef.onDisconnect().remove();

        // Set up typing indicator auto-cleanup on disconnect
        userTypingRef.onDisconnect().remove();
      } catch (error) {
        handleError(
          error,
          "user-status",
          "Failed to update online status",
          false,
        );
      }

      // Set up listeners with error handling
      try {
        listenForMessages(user);
        listenForOnlineUsers();
        listenForTyping();
        markMessagesAsRead(user);
      } catch (error) {
        handleError(
          error,
          "setup-listeners",
          "Failed to initialize chat features",
        );
      }
    } catch (error) {
      handleError(error, "setup-chat", "Failed to set up chat page");
      // Try to recover by showing login page
      chatPage.classList.add("hidden");
      loginPage.classList.remove("hidden");
    }
  }

  // Sign Out
  logoutButton.addEventListener("click", async () => {
    console.log("Logout Button Clicked");

    if (!auth.currentUser) {
      showNotification("No user logged in", "warning");
      return;
    }

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
      const userStatusRef = database.ref(`onlineUsers/${auth.currentUser.uid}`);
      const userTypingRef = database.ref(`typing/${auth.currentUser.uid}`);

      // Try to remove online status and typing status, but don't block logout if it fails
      try {
        await Promise.all([userStatusRef.remove(), userTypingRef.remove()]);
      } catch (error) {
        console.warn("Failed to remove user status:", error);
      }

      await auth.signOut();
      console.log("User signed out");
      showNotification("Logged out successfully", "success", 2000);

      // Clean up listeners
      if (databaseConnectionRef) {
        databaseConnectionRef.off();
      }
    } catch (error) {
      handleError(error, "logout");
    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = "Logout";
    }
  });

  // Send Message
  sendButton.addEventListener("click", sendMessage);
  messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendMessage();
    } else {
      handleTyping();
    }
  });

  // Real-time character counter
  messageInput.addEventListener("input", () => {
    const length = messageInput.value.length;
    updateCharacterCounter(length);

    // Disable send button if over limit
    if (length > MESSAGE_MAX_LENGTH) {
      sendButton.disabled = true;
      messageInput.classList.add("error");
    } else {
      sendButton.disabled = isRateLimited;
      messageInput.classList.remove("error");
    }
  });

  function updateCharacterCounter(length) {
    const counter = document.getElementById("char-counter");
    if (counter) {
      counter.textContent = `${length}/${MESSAGE_MAX_LENGTH}`;
      if (length > MESSAGE_MAX_LENGTH) {
        counter.classList.add("error");
      } else if (length > MESSAGE_MAX_LENGTH * 0.9) {
        counter.classList.add("warning");
        counter.classList.remove("error");
      } else {
        counter.classList.remove("warning", "error");
      }
    }
  }

  function validateMessage(message) {
    // Check if message is empty
    if (!message || message.trim().length < MESSAGE_MIN_LENGTH) {
      return { valid: false, error: "Message cannot be empty" };
    }

    // Check message length
    if (message.length > MESSAGE_MAX_LENGTH) {
      return {
        valid: false,
        error: `Message too long (max ${MESSAGE_MAX_LENGTH} characters)`,
      };
    }

    // Check for excessive whitespace
    if (message.trim().length < message.length * 0.1) {
      return { valid: false, error: "Message contains too much whitespace" };
    }

    // Basic spam detection - repeated characters
    const repeatedChars = /(.)\1{20,}/;
    if (repeatedChars.test(message)) {
      return { valid: false, error: "Message appears to be spam" };
    }

    return { valid: true };
  }

  function checkRateLimit() {
    const now = Date.now();

    // Remove timestamps outside the rate limit window
    messageSentTimes = messageSentTimes.filter(
      (time) => now - time < RATE_LIMIT_WINDOW,
    );

    // Check if rate limit exceeded
    if (messageSentTimes.length >= RATE_LIMIT_MESSAGES) {
      return {
        allowed: false,
        error: `Too many messages. Please wait ${RATE_LIMIT_COOLDOWN / 1000} seconds.`,
      };
    }

    return { allowed: true };
  }

  function showError(message) {
    const errorDiv = document.getElementById("error-message");
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.classList.remove("hidden");

      // Auto-hide after 5 seconds
      setTimeout(() => {
        errorDiv.classList.add("hidden");
      }, 5000);
    }
  }

  async function sendMessage() {
    const message = messageInput.value.trim();

    // Check if online
    if (!isOnline) {
      showNotification("Cannot send message while offline", "error");
      return;
    }

    if (!auth.currentUser) {
      showError("You must be logged in to send messages");
      return;
    }

    // Validate message
    const validation = validateMessage(message);
    if (!validation.valid) {
      showError(validation.error);
      return;
    }

    // Check rate limit
    const rateLimitCheck = checkRateLimit();
    if (!rateLimitCheck.allowed) {
      showError(rateLimitCheck.error);
      isRateLimited = true;
      sendButton.disabled = true;

      // Re-enable after cooldown
      setTimeout(() => {
        isRateLimited = false;
        sendButton.disabled = false;
        messageSentTimes = [];
      }, RATE_LIMIT_COOLDOWN);
      return;
    }

    // Send message
    const messagesRef = database.ref("messages");
    sendButton.disabled = true; // Prevent double-sending

    try {
      await retryOperation(
        async () => {
          return messagesRef.push({
            uid: auth.currentUser.uid,
            user: auth.currentUser.displayName,
            message: message,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            readBy: { [auth.currentUser.uid]: true },
          });
        },
        3,
        500,
      );

      console.log("Message sent successfully");
      messageInput.value = "";
      updateCharacterCounter(0);
      stopTyping();

      // Track message send time for rate limiting
      messageSentTimes.push(Date.now());
    } catch (error) {
      handleError(error, "send-message");

      // Show old error div for backwards compatibility
      showError("Failed to send message. Please try again.");
    } finally {
      sendButton.disabled = false;
    }
  }

  function handleTyping() {
    if (!auth.currentUser || !isOnline) {
      return;
    }

    try {
      const typingRef = database.ref(`typing/${auth.currentUser.uid}`);
      typingRef
        .set({
          displayName: auth.currentUser.displayName,
          timestamp: firebase.database.ServerValue.TIMESTAMP,
        })
        .catch((error) => {
          console.error("Failed to update typing status:", error);
        });

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(stopTyping, 2000);
    } catch (error) {
      console.error("Error in handleTyping:", error);
    }
  }

  function stopTyping() {
    if (!auth.currentUser) {
      return;
    }

    try {
      const typingRef = database.ref(`typing/${auth.currentUser.uid}`);
      typingRef.remove().catch((error) => {
        console.error("Failed to clear typing status:", error);
      });
    } catch (error) {
      console.error("Error in stopTyping:", error);
    }
  }

  function listenForMessages(currentUser) {
    const messagesRef = database.ref("messages");
    messagesRef.off("child_added");
    messagesRef.off("child_changed");
    messagesRef.off("child_removed");

    messagesRef.on("child_changed", (snapshot) => {
      const message = messagesDiv.querySelector(`[data-key="${snapshot.key}"]`);
      const updatedMessage = createMessageElement(snapshot.key, snapshot.val());

      if (message && updatedMessage) {
        message.replaceWith(updatedMessage);
      }
    });

    messagesRef.on("child_removed", (snapshot) => {
      const message = messagesDiv.querySelector(`data-key="${snapshot.key}"]`);

      if (message) {
        message.remove();
      }
    });

    // Load initial batch of messages (most recent)
    messagesRef
      .orderByChild("timestamp")
      .limitToLast(MESSAGES_PER_PAGE)
      .once(
        "value",
        (snapshot) => {
          try {
            const messages = [];
            snapshot.forEach((childSnapshot) => {
              messages.push({
                key: childSnapshot.key,
                data: childSnapshot.val(),
              });
            });

            // Track oldest message for pagination
            if (messages.length > 0) {
              oldestMessageKey = messages[0].key;
              oldestMessageTimestamp = messages[0].data.timestamp;
              hasMoreMessages = messages.length >= MESSAGES_PER_PAGE;
            } else {
              hasMoreMessages = false;
            }

            // Render messages
            messages.forEach((msg) => {
              if (msg.data) {
                addMessageToDOM(msg.key, msg.data, false);

                // Mark as read
                if (
                  auth.currentUser &&
                  (!msg.data.readBy || !msg.data.readBy[auth.currentUser.uid])
                ) {
                  markSingleMessageAsRead(msg.key);
                }
              }
            });

            initialMessagesLoaded = true;
            updateLoadMoreButton();

            // Scroll to bottom after initial load
            setTimeout(() => {
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }, 100);

            // Now listen for new messages
            listenForNewMessages(currentUser);
          } catch (error) {
            handleError(error, "load-messages", "Failed to load messages");
          }
        },
        (error) => {
          handleError(error, "load-messages", "Failed to load messages");
        },
      );
  }

  function listenForNewMessages(currentUser) {
    // Listen for new messages added after initial load
    const messagesRef = database.ref("messages");

    // Only listen for messages added after the most recent one we loaded
    messagesRef
      .orderByChild("timestamp")
      .startAt(Date.now())
      .on(
        "child_added",
        (snapshot) => {
          try {
            if (!initialMessagesLoaded) return;

            const messageData = snapshot.val();
            if (!messageData) {
              console.warn("Received null message data");
              return;
            }

            // Check if this message is not already in the DOM
            const existingMessage = document.querySelector(
              `[data-key="${snapshot.key}"]`,
            );
            if (existingMessage) {
              return;
            }

            addMessageToDOM(snapshot.key, messageData, true);

            // Mark the message as read if the user is active and logged in
            if (
              auth.currentUser &&
              (!messageData.readBy || !messageData.readBy[auth.currentUser.uid])
            ) {
              markSingleMessageAsRead(snapshot.key);
            }
          } catch (error) {
            handleError(error, "load-messages", null, false);
          }
        },
        (error) => {
          handleError(
            error,
            "load-messages",
            "Failed to listen for new messages",
          );
        },
      );
  }

  async function loadMoreMessages() {
    if (!hasMoreMessages || isLoadingMoreMessages || !oldestMessageTimestamp) {
      return;
    }

    isLoadingMoreMessages = true;
    updateLoadMoreButton();

    // Save current scroll position
    const scrollHeight = messagesDiv.scrollHeight;
    const scrollTop = messagesDiv.scrollTop;

    try {
      const messagesRef = database.ref("messages");
      const snapshot = await messagesRef
        .orderByChild("timestamp")
        .endBefore(oldestMessageTimestamp)
        .limitToLast(MESSAGES_LOAD_MORE)
        .once("value");

      const messages = [];
      snapshot.forEach((childSnapshot) => {
        messages.push({
          key: childSnapshot.key,
          data: childSnapshot.val(),
        });
      });

      if (messages.length === 0) {
        hasMoreMessages = false;
        showNotification("No more messages to load", "info", 2000);
      } else {
        // Update oldest message tracker
        oldestMessageKey = messages[0].key;
        oldestMessageTimestamp = messages[0].data.timestamp;
        hasMoreMessages = messages.length >= MESSAGES_LOAD_MORE;

        // Prepend messages to the DOM
        messages.forEach((msg) => {
          if (msg.data) {
            prependMessageToDOM(msg.key, msg.data);
          }
        });

        // Restore scroll position (maintain user's view)
        const newScrollHeight = messagesDiv.scrollHeight;
        messagesDiv.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
      }
    } catch (error) {
      handleError(error, "load-more-messages", "Failed to load more messages");
      hasMoreMessages = true; // Allow retry
    } finally {
      isLoadingMoreMessages = false;
      updateLoadMoreButton();
    }
  }

  function updateLoadMoreButton() {
    const loadMoreBtn = document.getElementById("load-more-btn");
    const loadMoreContainer = document.getElementById("load-more-container");

    if (!loadMoreBtn || !loadMoreContainer) return;

    if (!initialMessagesLoaded) {
      loadMoreContainer.classList.add("hidden");
      return;
    }

    if (hasMoreMessages) {
      loadMoreContainer.classList.remove("hidden");
      loadMoreBtn.disabled = isLoadingMoreMessages;
      loadMoreBtn.textContent = isLoadingMoreMessages
        ? "Loading..."
        : `Load More Messages (${MESSAGES_LOAD_MORE})`;
    } else {
      loadMoreContainer.classList.add("hidden");
    }
  }

  function createMessageElement(messageKey, messageData) {
    // Validate message data
    if (!messageData || !messageData.user || !messageData.message) {
      console.warn("Invalid message data:", messageData);
      return null;
    }

    const messageElement = document.createElement("div");
    messageElement.classList.add("message-item");
    messageElement.dataset.key = messageKey;

    const strongUser = document.createElement("strong");
    // Sanitize user display name
    strongUser.textContent = `${String(messageData.user).substring(0, 100)}:`;

    const contentSpan = document.createElement("span");
    contentSpan.classList.add("message-content");
    // Sanitize message content
    contentSpan.textContent = ` ${String(messageData.message).substring(0, 1000)} `;

    const time = new Date(messageData.timestamp);
    const formattedTime = isNaN(time.getTime())
      ? ""
      : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const ts = document.createElement("span");
    ts.classList.add("timestamp");
    ts.textContent = formattedTime ? `(${formattedTime})` : "";

    messageElement.appendChild(strongUser);
    messageElement.appendChild(contentSpan);
    messageElement.appendChild(ts);

    // Only show the editting option to comments written by the logged-in user
    if (auth.currentUser && messageData.uid === auth.currentUser.uid) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.classList.add("button-secondary", "edit-button");

      editButton.addEventListener("click", async () => {
        const editedMessage = prompt("Edit your comment:", messageData.message);

        if (editedMessage === null) return;

        const message = editedMessage.trim();
        const validation = validateMessage(message);

        if (!validation.valid) {
          alert(validation.error);
          return;
        }

        try {
          await database.ref(`messages/${messageKey}`).update({
            message: message,
          });

          messageData.message = message;
          contentSpan.textContent = ` ${message} `;
        } catch (error) {
          alert("Couldn't save the edit.");
          console.error(error);
        }
      });

      messageElement.appendChild(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.classList.add("button-secondary", "delete-button");

      deleteButton.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;

        try {
          await database.ref(`messages/${messageKey}`).remove();
        } catch (error) {
          alert("Couldn't delete message.");
          console.error(error);
        }
      });

      messageElement.appendChild(deleteButton);
    }

    // Add unread indicator if necessary
    if (
      !messageData.readBy ||
      (auth.currentUser && !messageData.readBy[auth.currentUser.uid])
    ) {
      const unreadBadge = document.createElement("span");
      unreadBadge.classList.add("unread-indicator");
      unreadBadge.textContent = " (Unread)";
      messageElement.appendChild(unreadBadge);
    }

    return messageElement;
  }

  function addMessageToDOM(messageKey, messageData, shouldScroll = true) {
    try {
      const messageElement = createMessageElement(messageKey, messageData);
      if (!messageElement) return;

      messagesDiv.appendChild(messageElement);

      // Scroll to bottom for new messages
      if (shouldScroll) {
        try {
          messagesDiv.scroll({
            top: messagesDiv.scrollHeight,
            behavior: "smooth",
          });
        } catch (scrollError) {
          // Fallback for older browsers
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
      }
    } catch (error) {
      console.error("Error adding message to DOM:", error);
    }
  }

  function prependMessageToDOM(messageKey, messageData) {
    try {
      // Check if message already exists
      const existingMessage = document.querySelector(
        `[data-key="${messageKey}"]`,
      );
      if (existingMessage) {
        return;
      }

      const messageElement = createMessageElement(messageKey, messageData);
      if (!messageElement) return;

      // Get the load more container if it exists
      const loadMoreContainer = document.getElementById("load-more-container");

      // Insert after load more button or at the beginning
      if (loadMoreContainer && loadMoreContainer.nextSibling) {
        messagesDiv.insertBefore(messageElement, loadMoreContainer.nextSibling);
      } else if (messagesDiv.firstChild) {
        messagesDiv.insertBefore(messageElement, messagesDiv.firstChild);
      } else {
        messagesDiv.appendChild(messageElement);
      }
    } catch (error) {
      console.error("Error prepending message to DOM:", error);
    }
  }

  function listenForOnlineUsers() {
    const onlineUsersRef = database.ref("onlineUsers");
    onlineUsersList.innerHTML = "";

    onlineUsersRef.on(
      "value",
      (snapshot) => {
        try {
          clearOnlineUsers();
          snapshot.forEach((childSnapshot) => {
            const user = childSnapshot.val();
            if (user && user.displayName) {
              const userElement = document.createElement("div");
              userElement.classList.add("online-user");
              userElement.textContent = user.displayName;
              onlineUsersList.appendChild(userElement);
            }
          });
        } catch (error) {
          handleError(error, "online-users", null, false);
        }
      },
      (error) => {
        handleError(
          error,
          "online-users",
          "Failed to load online users",
          false,
        );
      },
    );
  }

  function listenForTyping() {
    const typingRef = database.ref("typing");

    typingRef.on(
      "value",
      (snapshot) => {
        try {
          if (snapshot.exists()) {
            const typingUsers = [];
            const currentTime = Date.now();
            const TYPING_TIMEOUT = 3000; // 3 seconds

            snapshot.forEach((childSnapshot) => {
              const uid = childSnapshot.key;
              const data = childSnapshot.val();

              // Skip current user and check timestamp validity
              if (auth.currentUser && uid === auth.currentUser.uid) {
                return;
              }

              if (data && data.displayName) {
                // Check if typing status is recent (within timeout)
                const isRecent =
                  !data.timestamp ||
                  currentTime - data.timestamp < TYPING_TIMEOUT;
                if (isRecent) {
                  typingUsers.push(data.displayName);
                }
              }
            });

            // Display typing indicator with proper formatting
            if (typingUsers.length > 0) {
              typingIndicator.classList.remove("hidden");

              if (typingUsers.length === 1) {
                typingIndicator.textContent = `${typingUsers[0]} is typing...`;
              } else if (typingUsers.length === 2) {
                typingIndicator.textContent = `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
              } else if (typingUsers.length === 3) {
                typingIndicator.textContent = `${typingUsers[0]}, ${typingUsers[1]}, and ${typingUsers[2]} are typing...`;
              } else {
                typingIndicator.textContent = `${typingUsers[0]}, ${typingUsers[1]}, and ${typingUsers.length - 2} others are typing...`;
              }
            } else {
              typingIndicator.classList.add("hidden");
            }
          } else {
            typingIndicator.classList.add("hidden");
          }
        } catch (error) {
          console.error("Error in typing listener:", error);
          typingIndicator.classList.add("hidden");
        }
      },
      (error) => {
        console.error("Failed to listen for typing:", error);
      },
    );
  }

  function markMessagesAsRead(user) {
    const messagesRef = database.ref("messages");

    messagesRef
      .once("value", (snapshot) => {
        try {
          snapshot.forEach((childSnapshot) => {
            const messageKey = childSnapshot.key;
            const messageData = childSnapshot.val();

            if (!messageData) return;

            // If the message hasn't been read by this user, mark it as read
            if (!messageData.readBy || !messageData.readBy[user.uid]) {
              let updates = {};
              updates[`messages/${messageKey}/readBy/${user.uid}`] = true;

              database
                .ref()
                .update(updates)
                .catch((error) => {
                  console.error("Failed to mark message as read:", error);
                });

              // Remove unread badge from DOM
              const messageElement = document.querySelector(
                `[data-key="${messageKey}"]`,
              );
              if (messageElement) {
                const unreadBadge =
                  messageElement.querySelector(".unread-indicator");
                if (unreadBadge) {
                  unreadBadge.remove();
                }
              }
            }
          });
        } catch (error) {
          console.error("Error marking messages as read:", error);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch messages for read status:", error);
      });
  }

  function markSingleMessageAsRead(messageKey) {
    if (!auth.currentUser) {
      console.warn("Cannot mark message as read: No user logged in");
      return;
    }

    const updates = {};
    updates[`messages/${messageKey}/readBy/${auth.currentUser.uid}`] = true;

    database
      .ref()
      .update(updates)
      .then(() => {
        // Remove unread badge from DOM
        const messageElement = document.querySelector(
          `[data-key="${messageKey}"]`,
        );
        if (messageElement) {
          const unreadBadge = messageElement.querySelector(".unread-indicator");
          if (unreadBadge) {
            unreadBadge.remove();
          }
        }
      })
      .catch((error) => {
        console.error("Failed to mark single message as read:", error);
      });
  }

  function clearMessages() {
    messagesDiv.innerHTML = "";

    // Reset pagination state
    oldestMessageTimestamp = null;
    oldestMessageKey = null;
    hasMoreMessages = true;
    isLoadingMoreMessages = false;
    initialMessagesLoaded = false;
  }

  function clearOnlineUsers() {
    onlineUsersList.innerHTML = "";
  }

  listenForTyping();

  // Load More Messages button
  const loadMoreBtn = document.getElementById("load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      loadMoreMessages();
    });
  }

  // Handle visibility change to mark messages as read when user views the chat
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && auth.currentUser) {
      markMessagesAsRead(auth.currentUser);
    }
  });
});
