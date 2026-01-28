# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.7.x   | :white_check_mark: |
| < 0.7   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to the maintainers (see CONTRIBUTORS or package.json for contact)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response:** Within 48 hours
- **Status Update:** Within 7 days
- **Resolution Target:** Within 30 days for critical issues

## Security Considerations

### Compiler Security

RadiantScript compiles high-level code to Radiant Script bytecode. Security considerations:

1. **Input Validation:** The compiler validates all inputs but may not catch all semantic errors
2. **Bytecode Output:** Always verify compiled bytecode before deployment
3. **No Runtime Guarantees:** The compiler cannot guarantee runtime security of deployed contracts

### Contract Security Best Practices

When writing RadiantScript contracts:

1. **Test Thoroughly:** Use the integration test suite before mainnet deployment
2. **Audit Critical Contracts:** Any contract handling significant value should be audited
3. **Use Known Patterns:** Prefer established contract patterns over novel approaches
4. **Validate All Inputs:** Never trust external data without validation
5. **Consider Edge Cases:** Test with boundary values and unexpected inputs

### Dependencies

This project uses the following security-relevant dependencies:

- `@radiantblockchain/radiantjs` - Core cryptographic operations
- `@radiantblockchain/constants` - Protocol constants

Keep dependencies updated and monitor for security advisories.

## Known Limitations

1. **Alpha Status:** RadiantScript is in alpha; the language may change
2. **No Formal Verification:** Contracts are not formally verified
3. **Limited Audit:** The compiler has not undergone a formal security audit

## Security Updates

Security updates will be released as patch versions. Subscribe to releases to stay informed.

---

*Last updated: January 2026*
