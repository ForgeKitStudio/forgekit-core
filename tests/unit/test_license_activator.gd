extends GutTest
## Unit tests for LicenseActivator: HMAC-SHA256 verification against a
## publisher key. Covers valid signatures, tampered signatures, empty
## signatures, and empty license ids. The activator is a pure verifier
## and performs no file I/O.


const LICENSE_ACTIVATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/licensing/license_activator.gd")

const TEST_KEY := "test-publisher-key-forgekit"
const TEST_LICENSE_ID := "forgekit_rpg-customer-12345"


static func _hex_hmac(key: String, message: String) -> String:
	var ctx: HMACContext = HMACContext.new()
	var err: int = ctx.start(HashingContext.HASH_SHA256, key.to_utf8_buffer())
	assert(err == OK, "HMAC start must succeed in test helper")
	err = ctx.update(message.to_utf8_buffer())
	assert(err == OK, "HMAC update must succeed in test helper")
	return ctx.finish().hex_encode()


static func _flip_last_hex_char(value: String) -> String:
	# Produces a same-length hex string that is guaranteed to differ in the
	# final nibble, without relying on case-sensitive character comparisons.
	var last: String = value.substr(value.length() - 1, 1)
	var replacement: String = "0" if last != "0" else "1"
	return value.substr(0, value.length() - 1) + replacement


func _make_activator() -> Object:
	var activator: Object = LICENSE_ACTIVATOR_SCRIPT.new()
	activator.set_key_for_testing(TEST_KEY.to_utf8_buffer())
	return activator


# ---------------------------------------------------------------------------
# verify()
# ---------------------------------------------------------------------------

func test_verify_returns_true_for_valid_signature() -> void:
	var activator: Object = _make_activator()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	assert_true(
		activator.verify(TEST_LICENSE_ID, signature),
		"Valid HMAC-SHA256 signature over license_id must verify"
	)


func test_verify_returns_false_for_tampered_signature() -> void:
	var activator: Object = _make_activator()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	var tampered: String = _flip_last_hex_char(signature)
	assert_false(
		activator.verify(TEST_LICENSE_ID, tampered),
		"Tampered signature must not verify"
	)


func test_verify_returns_false_for_tampered_license_id() -> void:
	var activator: Object = _make_activator()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	assert_false(
		activator.verify(TEST_LICENSE_ID + "-evil", signature),
		"Signature bound to a different license id must not verify"
	)


func test_verify_returns_false_for_empty_signature() -> void:
	var activator: Object = _make_activator()
	assert_false(
		activator.verify(TEST_LICENSE_ID, ""),
		"Empty signature must not verify"
	)


func test_verify_returns_false_for_empty_license_id() -> void:
	var activator: Object = _make_activator()
	# The verifier rejects empty license ids as malformed input before
	# computing any HMAC, so we pass an arbitrary well-formed hex blob
	# of SHA-256 length (64 hex chars) as the candidate signature.
	var dummy_signature: String = "0".repeat(64)
	assert_false(
		activator.verify("", dummy_signature),
		"Empty license_id must not verify"
	)


func test_verify_returns_false_when_signature_length_differs() -> void:
	var activator: Object = _make_activator()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	var truncated: String = signature.substr(0, signature.length() - 2)
	assert_false(
		activator.verify(TEST_LICENSE_ID, truncated),
		"Signature with a different length than the expected digest must not verify"
	)


func test_verify_is_case_sensitive_on_hex_signature() -> void:
	var activator: Object = _make_activator()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID).to_lower()
	assert_true(
		activator.verify(TEST_LICENSE_ID, signature),
		"Lowercase hex from HMACContext.finish().hex_encode() must verify"
	)
	assert_false(
		activator.verify(TEST_LICENSE_ID, signature.to_upper()),
		"Uppercase hex does not match lowercase digest produced by HMACContext; must not verify"
	)


# ---------------------------------------------------------------------------
# Default publisher key
# ---------------------------------------------------------------------------

func test_verify_uses_default_publisher_key_when_not_overridden() -> void:
	# Without calling set_key_for_testing(), the activator must use the
	# constant PUBLISHER_HMAC_KEY embedded in the script.
	var activator: Object = LICENSE_ACTIVATOR_SCRIPT.new()
	var default_key: String = LICENSE_ACTIVATOR_SCRIPT.PUBLISHER_HMAC_KEY
	var signature: String = _hex_hmac(default_key, TEST_LICENSE_ID)
	assert_true(
		activator.verify(TEST_LICENSE_ID, signature),
		"Default publisher key must be used when no override is set"
	)


func test_default_publisher_key_is_non_empty() -> void:
	var default_key: String = LICENSE_ACTIVATOR_SCRIPT.PUBLISHER_HMAC_KEY
	assert_false(default_key.is_empty(), "PUBLISHER_HMAC_KEY must not be empty")
