# Smart-account wallet connector (experimental)

The `quais/smart-account` entry point provides a portable client and optional browser
popup transport. It has no Privy, React, relay server, factory address, token catalog
dependency for the connector. An optional Safe adapter is exported alongside it. It is not an ERC-4337 bundler client, an EIP-1193 provider,
or a replacement for the existing native `Wallet` signer.

```ts
import { SmartAccountClient, createPopupTransport } from 'quais/smart-account';

const wallet = new SmartAccountClient(
    createPopupTransport({
        walletUrl: 'https://wallet.qu.ai', // configure a trusted wallet host
    }),
);
// Call from a click handler so the browser permits the popup.
const account = await wallet.connect();
const capabilities = await wallet.getCapabilities();
const operation = await wallet.sendCalls({
    chainId: account.chainId,
    account: account.address,
    calls: [{ to: recipient, value: '1000000000000000000', data: '0x' }],
});
// Operation IDs are opaque relay IDs, not transaction hashes.
const status = await wallet.getOperation(operation.id);
// Only status.state === 'confirmed' reports confirmed success.
await wallet.disconnect();
wallet.destroy();
```

Amounts are decimal base-unit strings. `data` is hexadecimal contract calldata.
The selected wallet determines supported actions, contract implementation, signing
provider and sponsorship. Check capabilities before using optional methods.
`getFeeQuote` is available to transports with quote support; the current Quai Smart
Wallet host advertises `payment.quotes: false` and rejects that method. All actions
accepted by that host's relay are sponsored without reimbursement, subject to capacity.
Capabilities do not reserve gas or guarantee admission.

A custom `WalletTransport` may replace the popup transport for native/mobile hosts.
It must enforce the same consent, signing and response-validation requirements.
`serveWalletRequests` supplies source/origin/channel validation for browser hosts;
it does not itself implement permissions, account verification or transaction review.
The reference Quai Smart Wallet host supplies these separately.

## Security and lifecycle

- Pin the wallet URL; never take it from an untrusted transaction or query string.
- HTTPS is required except exact localhost origins for development. Popup messages
  bind both window identity and origin, version, channel and request ID.
- One outstanding request per connector. Requests are never automatically retried.
- `AbortSignal`, popup closure and timeouts stop waiting. They cannot reverse a
  transaction already submitted. Inspect activity/status before any retry.
- Keep the popup open for noninteractive status reads. If closed, invoke the next
  request from a user gesture to reopen it. Reloading a pending popup requires recovery.
- Importing the module in Node is safe. Only creating the popup transport needs a browser.
- A connected address is the smart account, not its owner signer. Changing an app's
  embedded signer does not move funds or transfer ownership.
- Contract adapters and manifests must be versioned and reviewed independently.

This source addition is not a published npm release. Native end-to-end execution and
supported signers must be tested by integrating wallet hosts before production use.

## Safe 1.4.1 adapter

The same entry point exports pure upstream Safe helpers, without a default deployment,
RPC, UI or signer. Supply independently verified contract addresses:

```ts
import {
    findSafe,
    encodeSafeCreate,
    safeRequest,
    encodeSafeExecute,
    safePersonalSignature,
    safeSigner,
    verifySafeDeployment,
    verifySafeAccount,
    TypedDataEncoder,
} from 'quais';

const predicted = findSafe(factory, owner, deployment);
const setup = encodeSafeCreate(owner, factory, deployment);
// Factory setup is atomic: one owner, threshold one, pinned handler, no modules,
// guard, setup payment or setup delegatecall. Show consent before submission.
await verifySafeDeployment(reader, factory, deployment);
// After confirmed creation:
await verifySafeAccount(reader, predicted.account, deployment, owner);
const request = safeRequest(chainId, predicted.account, calls, nonce, deployment.multiSendCallOnly);
const digest = TypedDataEncoder.hash(request.domain, request.types, request.value);
// Trusted wallet host only, after decoded review. Provider is the chosen EVM signer.
const raw = await provider.request({ method: 'personal_sign', params: [digest, owner] });
const signature = safePersonalSignature(raw);
if (safeSigner(request, signature) !== owner) throw Error('Owner signature mismatch');
const data = encodeSafeExecute(request, signature);
// Submit {to: predicted.account, data} through a native Quai sender or relay.
```

`deployment` contains singleton, fallbackHandler and multiSendCallOnly. `reader`
has `code(address)` and `call(address, calldata)` methods. findSafe searches the
existing Safe saltNonce for Cyprus-1; it does not alter upstream contract bytes.
Verify the owner's provider account before and after prompts and discard responses
after disconnect. Do not expose generic signing to untrusted dApps.

safeRequest defaults to fully sponsored execution (zero reimbursement). It uses
CALL or a delegatecall to supplied MultiSendCallOnly; callers must verify that
address. decodeSponsoredSafe enforces the sponsored subset, not all Safe features.
SafeTx has no expiry; nonce consumption prevents replay. A UI timeout does not
invalidate a signed transaction. safeMessageRequest constructs the standard handler's
account-bound ERC-1271 wrapping; it does not use ERC-7739 envelopes.

This adapter supports the single-owner, threshold-one profile without modules/guard.
Safe itself supports more configurations. Native-funded integration and actual
browser signers must be tested by the host; inclusion in this library does not
certify a live deployment. See [artifact provenance](SAFE_ARTIFACTS.md).
