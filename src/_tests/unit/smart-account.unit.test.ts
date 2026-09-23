import assert from 'assert';
import { SmartAccountClient } from '../../smart-account/index.js';
import { parseCalls, parseResult, trustedOrigin } from '../../smart-account/connector-protocol.js';
import type { WalletTransport } from '../../smart-account/index.js';

describe('smart-account client (no browser or signer required)', function () {
    const account = '0x00328DEb469eB9Ab102A7B0b725799ea10140a0D';
    it('accepts an interchangeable transport', async function () {
        const requests: string[] = [];
        const transport: WalletTransport = {
            async request(method) {
                requests.push(method);
                return { address: account, chainId: '9' };
            },
            destroy() {
                requests.push('destroy');
            },
        };
        const client = new SmartAccountClient(transport);
        assert.deepEqual(await client.connect(), { address: account, chainId: '9' });
        await client.getCapabilities();
        client.destroy();
        assert.deepEqual(requests, ['connect', 'getCapabilities', 'destroy']);
    });
    it('rejects invalid quantities, extra privileges and insecure origins', function () {
        const input = { account, chainId: '9', calls: [{ to: account, value: '1', data: '0x' }] };
        assert.deepEqual(parseCalls(input), input);
        assert.throws(() => parseCalls({ ...input, sponsored: true }));
        assert.throws(() => parseCalls({ ...input, calls: [{ to: account, value: '-1', data: '0x' }] }));
        assert.throws(() => trustedOrigin('https://wallet.example/path'));
        assert.throws(() => trustedOrigin('http://wallet.example'));
        assert.equal(trustedOrigin('https://wallet.example'), 'https://wallet.example');
        assert.throws(() => parseResult('sendCalls', { id: 'made-up', state: 'confirmed' }));
    });
});
