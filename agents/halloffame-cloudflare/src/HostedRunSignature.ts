/**
 * Verifies that a platform automation dispatch came from the Hall Of Fame API:
 * a hex HMAC-SHA256 of the exact body, keyed with the shared secret.
 */
export class HostedRunSignature {
  static async verify(body: string, signature: string | null, secret: string | undefined) {
    if (!signature || !secret) return false

    const expected = await HostedRunSignature.sign(body, secret)
    if (expected.length !== signature.length) return false

    let difference = 0
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
    }

    return difference === 0
  }

  static async sign(body: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))

    return [
      ...new Uint8Array(digest)
    ].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}
