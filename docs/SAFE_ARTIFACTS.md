# Safe adapter artifact provenance

Release: @safe-global/safe-contracts@1.4.1.
Source commit: bf943f80fec5ac647159d26161446ac5d716a294.

The embedded SafeProxy creation bytecode is copied verbatim from the npm release;
runtime hashes are pinned for Safe, SafeProxyFactory, CompatibilityFallbackHandler,
MultiSendCallOnly and SafeProxy. No source recompilation or wallet modification.
Ethereum deployment addresses are not assumed valid on Quai. All addresses come
from the integrating host's verified manifest.

Tarball: https://registry.npmjs.org/@safe-global/safe-contracts/-/safe-contracts-1.4.1.tgz
Integrity: sha512-fP1jewywSwsIniM04NsqPyVRFKPMAuirC3ftA/TA4X3Zc5EnwQp/UCJUU2PL/37/z/jMo8UUaJ+pnFNWmMU7dQ==

| Contract                     | Runtime keccak256                                                    |
| ---------------------------- | -------------------------------------------------------------------- |
| Safe                         | `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4` |
| SafeProxyFactory             | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |
| CompatibilityFallbackHandler | `0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9` |
| SafeProxy                    | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |
| MultiSendCallOnly            | `0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939` |

Original package and bytecode license: [LGPL-3.0-only](SAFE-LICENSE).
[Source](https://github.com/safe-global/safe-smart-account/tree/bf943f80fec5ac647159d26161446ac5d716a294),
[published deployments](https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1).
The upstream audit does not cover this adapter or the native Quai integration.
