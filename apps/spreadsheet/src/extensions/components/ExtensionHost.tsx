/**
 * Extension Host
 *
 * Secure iframe container for hosting cross-origin extensions.
 * Implements strict sandbox controls and postMessage communication.
 *
 * SECURITY CRITICAL:
 * - Uses cross-origin iframe (no allow-same-origin)
 * - Validates all message origins
 * - Validates all message structures
 * - Implements connection timeout and retry logic
 *
 * @module extensions/components/ExtensionHost
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import {
  EXTENSION_LOAD_TIMEOUT,
  EXTENSION_PROTOCOL_VERSION,
  getHostOrigin,
  HANDSHAKE_TIMEOUT,
  IFRAME_ALLOW_POLICY,
  IFRAME_REFERRER_POLICY,
  IFRAME_SANDBOX_FLAGS,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY,
  RETRY_MAX_DELAY,
} from '../constants';
import { formatValidationError, isValidExtensionOrigin, validateMessage } from '../security';
import type {
  ConnectedMessage,
  ExtensionInstance,
  ExtensionLifecycleState,
  ExtensionPermission,
  HostToExtensionMessage,
  InitMessage,
} from '../types';

// =============================================================================
// Types
// =============================================================================

interface ExtensionHostProps {
  /** Extension instance to host */
  extension: ExtensionInstance;
  /** Callback when extension state changes */
  onStateChange: (state: ExtensionLifecycleState, error?: string | null) => void;
  /** Callback when extension session is established */
  onSessionEstablished: (sessionId: string) => void;
  /** Callback when API request is received from extension */
  onApiRequest?: (requestId: string, method: string, args: unknown[]) => Promise<unknown>;
  /** Callback when extension subscribes to events */
  onSubscribe?: (events: string[]) => void;
  /** Callback when extension unsubscribes from events */
  onUnsubscribe?: (events: string[]) => void;
  /** Current spreadsheet context for INIT message */
  context?: {
    activeSheetId: string;
    activeSheetName: string;
    selection: { range: string } | null;
  };
}

interface ExtensionHostHandle {
  /** Send a message to the extension */
  postMessage: (message: HostToExtensionMessage) => void;
  /** Reload the extension iframe */
  reload: () => void;
  /** Get the current iframe element */
  getIframe: () => HTMLIFrameElement | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Calculate retry delay with exponential backoff
 */
function getRetryDelay(attempt: number): number {
  const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
  return Math.min(delay, RETRY_MAX_DELAY);
}

// =============================================================================
// Component
// =============================================================================

export const ExtensionHost = forwardRef<ExtensionHostHandle, ExtensionHostProps>(
  function ExtensionHost(
    {
      extension,
      onStateChange,
      onSessionEstablished,
      onApiRequest,
      onSubscribe,
      onUnsubscribe,
      context,
    },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryAttemptRef = useRef(0);
    const sessionIdRef = useRef<string | null>(null);
    const [iframeKey, setIframeKey] = useState(0);
    const [isIframeVisible, setIsIframeVisible] = useState(false);

    // Get the full URL for the extension
    const extensionUrl = `${extension.baseUrl}${extension.manifest.entryPoint}`;

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      postMessage: (message: HostToExtensionMessage) => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) {
          console.warn('[ExtensionHost] Cannot post message: iframe not ready');
          return;
        }

        // Only post to iframes that have a valid origin
        // Note: Due to sandbox, we can't read iframe's origin, so we use '*'
        // Security is enforced by origin validation on received messages
        iframe.contentWindow.postMessage(message, '*');
      },
      reload: () => {
        retryAttemptRef.current = 0;
        setIframeKey((k) => k + 1);
        onStateChange('loading');
      },
      getIframe: () => iframeRef.current,
    }));

    // Clear all timeouts
    const clearTimeouts = useCallback(() => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      if (handshakeTimeoutRef.current) {
        clearTimeout(handshakeTimeoutRef.current);
        handshakeTimeoutRef.current = null;
      }
    }, []);

    // Send INIT message to extension
    const sendInit = useCallback(() => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      const initMessage: InitMessage = {
        protocol: EXTENSION_PROTOCOL_VERSION,
        type: 'INIT',
        id: generateMessageId(),
        timestamp: Date.now(),
        hostOrigin: getHostOrigin(),
        permissions: extension.manifest.permissions as ExtensionPermission[],
        context: context || {
          activeSheetId: '',
          activeSheetName: 'Sheet1',
          selection: null,
        },
      };

      iframe.contentWindow.postMessage(initMessage, '*');

      // Set handshake timeout
      handshakeTimeoutRef.current = setTimeout(() => {
        onStateChange('error', 'Handshake timeout: Extension did not complete initialization');
      }, HANDSHAKE_TIMEOUT);
    }, [extension.manifest.permissions, context, onStateChange]);

    // Send CONNECTED message to extension
    const sendConnected = useCallback(
      (sessionId: string) => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;

        const connectedMessage: ConnectedMessage = {
          protocol: EXTENSION_PROTOCOL_VERSION,
          type: 'CONNECTED',
          id: generateMessageId(),
          timestamp: Date.now(),
          sessionId,
        };

        iframe.contentWindow.postMessage(connectedMessage, '*');
        sessionIdRef.current = sessionId;
        onSessionEstablished(sessionId);
        setIsIframeVisible(true);
        onStateChange('ready');
      },
      [onStateChange, onSessionEstablished],
    );

    // Handle message from extension
    const handleMessage = useCallback(
      async (event: MessageEvent) => {
        // CRITICAL: Validate origin
        if (!isValidExtensionOrigin(event.origin)) {
          console.warn('[ExtensionHost] Rejected message from unauthorized origin:', event.origin);
          return;
        }

        // Validate message structure
        const validationResult = validateMessage(event.data);
        if (!validationResult.valid) {
          console.warn(formatValidationError(validationResult, event.origin));
          return;
        }

        const message = validationResult.message!;

        // Handle message by type
        switch (message.type) {
          case 'READY': {
            // Verify extension ID matches (skip for sideloaded extensions)
            const isSideloaded = extension.manifest.id.startsWith('sideload-');
            if (!isSideloaded && message.extensionId !== extension.manifest.id) {
              console.warn(
                '[ExtensionHost] Extension ID mismatch:',
                message.extensionId,
                '!==',
                extension.manifest.id,
              );
              return;
            }

            // Check if this is initial READY or post-INIT READY
            if (extension.state === 'loading') {
              // First READY - clear load timeout and send INIT
              clearTimeouts();
              onStateChange('handshaking');
              sendInit();
            } else if (extension.state === 'handshaking') {
              // Second READY - handshake complete
              clearTimeouts();
              const sessionId = generateSessionId();
              sendConnected(sessionId);
            }
            break;
          }

          case 'API_REQUEST': {
            if (!onApiRequest) {
              console.warn('[ExtensionHost] No API request handler configured');
              return;
            }

            try {
              const result = await onApiRequest(message.id, message.method, message.args);

              // Send response
              const iframe = iframeRef.current;
              if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage(
                  {
                    protocol: EXTENSION_PROTOCOL_VERSION,
                    type: 'API_RESPONSE',
                    id: generateMessageId(),
                    timestamp: Date.now(),
                    requestId: message.id,
                    success: true,
                    result,
                  },
                  '*',
                );
              }
            } catch (error) {
              // Send error response
              const iframe = iframeRef.current;
              if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage(
                  {
                    protocol: EXTENSION_PROTOCOL_VERSION,
                    type: 'API_RESPONSE',
                    id: generateMessageId(),
                    timestamp: Date.now(),
                    requestId: message.id,
                    success: false,
                    error: {
                      code: 'API_ERROR',
                      message: error instanceof Error ? error.message : 'Unknown error',
                    },
                  },
                  '*',
                );
              }
            }
            break;
          }

          case 'SUBSCRIBE': {
            onSubscribe?.(message.events);
            break;
          }

          case 'UNSUBSCRIBE': {
            onUnsubscribe?.(message.events);
            break;
          }
        }
      },
      [
        extension.manifest.id,
        extension.state,
        onStateChange,
        onApiRequest,
        onSubscribe,
        onUnsubscribe,
        clearTimeouts,
        sendInit,
        sendConnected,
      ],
    );

    // Set up message listener
    useEffect(() => {
      window.addEventListener('message', handleMessage);
      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }, [handleMessage]);

    // Handle iframe load
    const handleLoad = useCallback(() => {
      // Clear load timeout
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }

      // Extension should send READY message after loading
      // If it doesn't, the handshake timeout will catch it
    }, []);

    // Handle iframe error
    const handleError = useCallback(() => {
      clearTimeouts();

      // Check if we should retry
      if (retryAttemptRef.current < MAX_RETRY_ATTEMPTS) {
        const delay = getRetryDelay(retryAttemptRef.current);
        retryAttemptRef.current++;

        onStateChange(
          'loading',
          `Load failed, retrying in ${delay / 1000}s (attempt ${retryAttemptRef.current}/${MAX_RETRY_ATTEMPTS})`,
        );

        setTimeout(() => {
          setIframeKey((k) => k + 1);
        }, delay);
      } else {
        onStateChange('error', `Failed to load extension after ${MAX_RETRY_ATTEMPTS} attempts`);
      }
    }, [clearTimeouts, onStateChange]);

    // Set up load timeout when iframe mounts
    useEffect(() => {
      onStateChange('loading');
      setIsIframeVisible(false);

      loadTimeoutRef.current = setTimeout(() => {
        handleError();
      }, EXTENSION_LOAD_TIMEOUT);

      return () => {
        clearTimeouts();
      };
    }, [iframeKey, handleError, clearTimeouts, onStateChange]);

    return (
      <div className="relative w-full h-full overflow-hidden">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={extensionUrl}
          // SECURITY CRITICAL: sandbox flags
          // - NO allow-same-origin (defeats cross-origin isolation)
          // - allow-scripts (required for extension code)
          // - allow-forms (for form submissions)
          // - allow-popups (for OAuth flows)
          // - allow-popups-to-escape-sandbox (popups not sandboxed)
          sandbox={IFRAME_SANDBOX_FLAGS}
          // Permissions policy
          allow={IFRAME_ALLOW_POLICY}
          // Referrer policy
          referrerPolicy={IFRAME_REFERRER_POLICY as React.HTMLAttributeReferrerPolicy}
          // Styling
          className={`absolute top-0 left-0 w-full h-full border-none bg-ss-surface ${
            !isIframeVisible ? 'invisible pointer-events-none' : ''
          }`}
          // Event handlers
          onLoad={handleLoad}
          onError={handleError}
          // Accessibility
          title={`Extension: ${extension.manifest.name}`}
          aria-label={`${extension.manifest.name} extension panel`}
        />
      </div>
    );
  },
);
