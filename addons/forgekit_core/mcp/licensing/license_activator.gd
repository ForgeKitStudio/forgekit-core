class_name LicenseActivator
extends RefCounted
## Offline verifier for ForgeKit module license keys.
##
## A license key is a hex-encoded HMAC-SHA256 digest of the plain `license_id`
## string, computed with the publisher's secret key. The same secret is
## embedded here as PUBLISHER_HMAC_KEY so Godot projects can verify a license
## without contacting a license server.
##
## This class performs verification only. File I/O for persisted license
## records is handled by a separate component.


## Publisher key compiled into ForgeKit Core. Kept as a plain constant so it
## ships with every install of the addon; rotating the publisher key requires
## a new Core release. Override for tests via `set_key_for_testing`.
const PUBLISHER_HMAC_KEY := "forgekit-publisher-hmac-key-v1"

## Length in hex characters of a SHA-256 digest (32 bytes = 64 hex chars).
const _SHA256_HEX_LENGTH := 64


var _key: PackedByteArray = PUBLISHER_HMAC_KEY.to_utf8_buffer()


## Overrides the publisher key used for verification. Intended for unit tests
## that need to sign license ids with a known key.
func set_key_for_testing(key_bytes: PackedByteArray) -> void:
	_key = key_bytes


## Returns true iff `signature` is the hex-encoded HMAC-SHA256 of `license_id`
## under the configured publisher key. Empty inputs always fail. An empty
## configured key is treated as a misconfiguration and always fails, even
## for a signature that was genuinely computed under an empty key. Hex
## comparison is constant-time with respect to signature length to avoid
## leaking timing information about which byte first mismatches.
func verify(license_id: String, signature: String) -> bool:
	# An empty publisher key is a misconfiguration. Reject every input
	# unconditionally rather than delegating to HMACContext, which would
	# either error at engine level or (under a manual HMAC implementation)
	# produce a cryptographically valid digest for the empty key.
	if _key.is_empty():
		return false
	if license_id.is_empty():
		return false
	if signature.is_empty():
		return false
	if signature.length() != _SHA256_HEX_LENGTH:
		return false

	var expected: String = _compute_hmac_hex(license_id)
	if expected.is_empty():
		return false

	return _constant_time_equals(expected, signature)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

## Computes HMAC-SHA256 over `license_id` bytes and returns the lowercase hex
## digest. Returns an empty string if the HMAC context rejects any step.
func _compute_hmac_hex(license_id: String) -> String:
	var ctx: HMACContext = HMACContext.new()
	var err: int = ctx.start(HashingContext.HASH_SHA256, _key)
	if err != OK:
		return ""
	err = ctx.update(license_id.to_utf8_buffer())
	if err != OK:
		return ""
	var digest: PackedByteArray = ctx.finish()
	if digest.is_empty():
		return ""
	return digest.hex_encode()


## Length-checked, constant-time equality for two strings of equal length.
## Iterates every character of the shorter input regardless of where the first
## mismatch occurs; early-returns only when the lengths differ.
static func _constant_time_equals(a: String, b: String) -> bool:
	if a.length() != b.length():
		return false
	var diff: int = 0
	for i in range(a.length()):
		diff |= a.unicode_at(i) ^ b.unicode_at(i)
	return diff == 0
