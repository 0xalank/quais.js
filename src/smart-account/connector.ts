import {
    CONNECTOR_PROTOCOL,
    WalletConnectorError,
    connectorBrowser,
    type WalletPopup,
    type ConnectorMessageEvent,
    boundedMessage,
    parseParams,
    parseResult,
    trustedOrigin,
    type WalletMethod,
    type SendCalls,
    type WalletAccount,
    type WalletCapabilities,
    type WalletOperation,
    type WalletFeeQuote,
} from './connector-protocol.js';
export * from './connector-protocol.js';

/**
 * Framework-, signer-, factory- and relay-independent request boundary.
 */
export interface WalletTransport {
    request(method: WalletMethod, params: unknown, signal?: AbortSignal): Promise<unknown>;
    destroy(): void;
}
export class SmartAccountClient {
    constructor(readonly transport: WalletTransport) {}
    connect(signal?: AbortSignal) {
        return this.transport.request('connect', {}, signal) as Promise<WalletAccount>;
    }
    getAccount(signal?: AbortSignal) {
        return this.transport.request('getAccount', {}, signal) as Promise<WalletAccount>;
    }
    getCapabilities(signal?: AbortSignal) {
        return this.transport.request('getCapabilities', {}, signal) as Promise<WalletCapabilities>;
    }
    getFeeQuote(request: SendCalls, signal?: AbortSignal) {
        return this.transport.request('getFeeQuote', request, signal) as Promise<WalletFeeQuote>;
    }
    sendCalls(request: SendCalls, signal?: AbortSignal) {
        return this.transport.request('sendCalls', request, signal) as Promise<WalletOperation>;
    }
    getOperation(id: string, signal?: AbortSignal) {
        return this.transport.request('getOperation', { id }, signal) as Promise<WalletOperation>;
    }
    disconnect(signal?: AbortSignal) {
        return this.transport.request('disconnect', {}, signal) as Promise<void>;
    }
    destroy() {
        this.transport.destroy();
    }
}

/**
 * Open requests from a user gesture. Never retries a transaction request automatically.
 */
export function createPopupTransport(options: { walletUrl: string; timeoutMs?: number }): WalletTransport {
    const browser = connectorBrowser();
    const url = new URL(options.walletUrl);
    const origin = trustedOrigin(url.origin);
    if (url.username || url.password || url.search || url.hash)
        throw new Error('Wallet URL must not contain credentials, query or fragment.');
    const timeout = options.timeoutMs ?? 180000;
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000) throw new Error('Invalid wallet timeout');
    let popup: WalletPopup | null = null,
        channel = browser.crypto.randomUUID(),
        disposed = false;
    let pending: { id: string; fail(error: Error): void } | undefined;
    return {
        request(method, params, signal) {
            if (disposed) return Promise.reject(new WalletConnectorError('DISCONNECTED', 'Connector disposed'));
            if (pending) return Promise.reject(new WalletConnectorError('BUSY', 'A wallet request is already pending'));
            if (signal?.aborted) return Promise.reject(new WalletConnectorError('CANCELLED', 'Request cancelled'));
            try {
                parseParams(method, params);
            } catch {
                return Promise.reject(new WalletConnectorError('INVALID_REQUEST', 'Invalid wallet request'));
            }
            if (!popup || popup.closed) {
                channel = browser.crypto.randomUUID();
                const destination = new URL(url.toString());
                // Fragment metadata is not sent to the hosting server or HTTP referrers.
                destination.hash = new URLSearchParams({
                    walletConnector: '1',
                    origin: trustedOrigin(browser.location.origin),
                    channel,
                }).toString();
                const opened = browser.window.open(new URL('about:blank'), '_blank', 'popup,width=460,height=780');
                if (opened) {
                    try {
                        // Clear the opener while the blank popup is still same-origin.
                        opened.opener = null;
                        opened.location.replace(destination.toString());
                        popup = opened;
                    } catch {
                        opened.close();
                        return Promise.reject(
                            new WalletConnectorError('POPUP_BLOCKED', 'Could not open the wallet popup.'),
                        );
                    }
                }
            }
            if (!popup)
                return Promise.reject(
                    new WalletConnectorError('POPUP_BLOCKED', 'Allow the wallet popup and try again.'),
                );
            const peer = popup,
                id = browser.crypto.randomUUID();
            const request = {
                protocol: CONNECTOR_PROTOCOL,
                version: 1,
                channel,
                id,
                method,
                params,
            };
            // Snapshot payload before asynchronous handshaking.
            const payload = JSON.parse(JSON.stringify(request));
            if (!boundedMessage(payload))
                return Promise.reject(new WalletConnectorError('INVALID_REQUEST', 'Request too large'));
            peer.focus();
            return new Promise((resolve, reject) => {
                let sent = false;
                const finish = (error?: Error, result?: unknown) => {
                    clearInterval(poll);
                    clearTimeout(timer);
                    browser.removeEventListener('message', receive);
                    signal?.removeEventListener('abort', abort);
                    pending = undefined;
                    if (error) reject(error);
                    else resolve(result);
                };
                const cancel = () => {
                    if (sent && !peer.closed)
                        peer.postMessage(
                            {
                                protocol: CONNECTOR_PROTOCOL,
                                version: 1,
                                channel,
                                id,
                                type: 'cancel',
                            },
                            origin,
                        );
                };
                const abort = () => {
                    cancel();
                    finish(
                        new WalletConnectorError(
                            'CANCELLED',
                            'Request cancelled. If approval began, check wallet activity before retrying.',
                        ),
                    );
                };
                const receive = (event: ConnectorMessageEvent) => {
                    if (event.source !== peer || event.origin !== origin || !boundedMessage(event.data)) return;
                    const data = event.data;
                    if (data?.protocol !== CONNECTOR_PROTOCOL || data.version !== 1 || data.channel !== channel) return;
                    if (data.type === 'ready' && !sent) {
                        sent = true;
                        peer.postMessage(payload, origin);
                        return;
                    }
                    if (data.type !== 'response' || data.id !== id) return;
                    if (data.error) {
                        if (data.error.code === 'RECONNECT' && popup === peer) {
                            popup = null;
                            peer.close();
                        }
                        finish(new WalletConnectorError(String(data.error.code), String(data.error.message)));
                    } else {
                        try {
                            finish(undefined, parseResult(method, data.result));
                        } catch {
                            finish(
                                new WalletConnectorError(
                                    'INVALID_RESPONSE',
                                    'Invalid wallet response. Check wallet activity before retrying.',
                                ),
                            );
                        }
                    }
                };
                const poll = setInterval(() => {
                    if (peer.closed) {
                        finish(
                            new WalletConnectorError(
                                'WALLET_CLOSED',
                                'Wallet closed. Check activity before resubmitting an approved action.',
                            ),
                        );
                        return;
                    }
                    if (!sent)
                        peer.postMessage(
                            {
                                protocol: CONNECTOR_PROTOCOL,
                                version: 1,
                                channel,
                                type: 'hello',
                            },
                            origin,
                        );
                }, 250);
                const timer = setTimeout(() => {
                    cancel();
                    finish(
                        new WalletConnectorError(
                            'TIMEOUT',
                            'Wallet request timed out. Check activity before resubmitting an approved action.',
                        ),
                    );
                }, timeout);
                pending = {
                    id,
                    fail: (error) => {
                        cancel();
                        finish(error);
                    },
                };
                browser.addEventListener('message', receive);
                signal?.addEventListener('abort', abort, { once: true });
            });
        },
        destroy() {
            disposed = true;
            pending?.fail(
                new WalletConnectorError('DISCONNECTED', 'Connector disposed. Submitted operations remain on-chain.'),
            );
            popup?.close();
            popup = null;
        },
    };
}
