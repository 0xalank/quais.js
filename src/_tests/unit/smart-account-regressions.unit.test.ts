import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serveWalletRequests } from '../../smart-account/connector-host.js';
import { CONNECTOR_PROTOCOL, WalletConnectorError, boundedMessage, parseRequest, parseResult, type ConnectorMessageEvent } from '../../smart-account/connector-protocol.js';

const account = '0x00328DEb469eB9Ab102A7B0b725799ea10140a0D';
const origin = 'https://dapp.example';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('smart-account protocol regressions', function () {
    it('uses the same UUIDv4 validation for host channels and requests', function () {
        const source = { postMessage() {} };
        for (const channel of ['-'.repeat(36), 'a'.repeat(36), '12345678-1234-1234-8234-123456789abc', '12345678-1234-4234-7234-123456789abc']) {
            assert.throws(() => serveWalletRequests({ origin, source, channel, async handle() {} }), /Invalid channel/);
            assert.throws(() => parseRequest({ protocol: CONNECTOR_PROTOCOL, version: 1, channel, id: randomUUID(), method: 'connect', params: {} }));
        }
    });
    it('rejects zero and malformed chains in capabilities and fee quotes', function () {
        const results = {
            getCapabilities: { protocolVersion: 1, chainId: '9', accountProtocol: 'custom', actions: [], payment: { mode: 'sponsored', quotes: true, guaranteed: false } },
            getFeeQuote: { id: 'quote', chainId: '9', account, actionHash: '0x' + 'ab'.repeat(32), payment: 'sponsored', userFeeWei: '0', expiresAt: '2026-09-18T00:00:00Z' },
        };
        for (const method of ['getCapabilities', 'getFeeQuote'] as const) {
            assert.deepEqual(parseResult(method, results[method]), results[method]);
            for (const chainId of ['0', '00', '-1', '01', 9, String(1n << 256n)]) {
                assert.throws(() => parseResult(method, { ...results[method], chainId }));
            }
        }
    });
    it('returns bounded errors for oversized or uncloneable responses and releases the request slot', async function () {
        const keys = ['addEventListener', 'removeEventListener'] as const;
        const saved = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
        let listener!: (event: ConnectorMessageEvent) => void;
        Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (_: string, fn: typeof listener) => { listener = fn; } });
        Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: () => {} });
        const replies: any[] = [];
        const source = { postMessage(value: unknown, target: string) { assert.equal(target, origin); replies.push(structuredClone(value)); } };
        const circular: any = {}; circular.self = circular;
        const outcomes = [
            () => ({ value: 'x'.repeat(131072) }),
            () => { throw new WalletConnectorError('X', 'x'.repeat(131072)); },
            () => circular,
            () => ({ fn() {} }),
            () => ({ address: account, chainId: '9' }),
        ];
        const channel = randomUUID().toUpperCase();
        let stop: (() => void) | undefined;
        try {
            stop = serveWalletRequests({ origin, source, channel, async handle() { return outcomes.shift()!(); } });
            for (let i = 0; i < 5; i++) {
                const id = randomUUID();
                listener({ origin, source, data: { protocol: CONNECTOR_PROTOCOL, version: 1, channel, id, method: 'connect', params: {} } });
                await tick();
                assert.equal(replies.length, i + 1);
                const reply = replies[i];
                assert.equal(reply.id, id);
                assert.equal(reply.channel, channel);
                assert.equal(reply.type, 'response');
                assert.equal(boundedMessage(reply), true);
                if (i < 4) {
                    assert.equal(reply.error.code, 'INVALID_RESPONSE');
                    assert.match(reply.error.message, /Check wallet activity/);
                    assert.equal('result' in reply, false);
                } else {
                    assert.deepEqual(reply.result, { address: account, chainId: '9' });
                }
            }
        } finally {
            stop?.();
            keys.forEach((key, index) => {
                if (saved[index]) Object.defineProperty(globalThis, key, saved[index]!);
                else Reflect.deleteProperty(globalThis, key);
            });
        }
    });
});
