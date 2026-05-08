extends GutTest
## Focused HMAC key-handling suite for LicenseActivator.
##
## Task 3.19.7 requires dedicated coverage of three HMAC key scenarios:
##   1. Correct publisher key                -> verify returns true.
##   2. Modified (tampered) publisher key    -> verify returns false,
##      both for a single-byte flip and for a completely different key.
##   3. Empty publisher key                  -> verify must NEVER return
##      true, including when a caller supplies a signature that was
##      genuinely computed under an empty key (cryptographically valid
##      but semantically a misconfiguration).


const LICENSE_ACTIVATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/licensing/license_activator.gd")

const LICENSE_ID := "forgekit_rpg-customer-7"
const PUBLISHER_KEY_CORRECT := "publisher-key-correct-v1"
const PUBLISHER_KEY_ALT := "totally-different-publisher-key-v2"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

static func _hex_hmac_bytes(key_bytes: PackedByteArray, message: String) -> String:
	# For non-empty keys, delegate to HMACContext. For an empty key we must
	# construct the HMAC manually: the engine rejects empty keys in
	# HMACContext.start (which is exactly the misconfiguration the verifier
	# is contracted to reject), but RFC 2104 is mathematically well-defined
	# for an empty key (pad to the 64-byte block with zeros, then apply
	# ipad/opad around SHA-256). We need the "genuine" empty-key HMAC to
	# prove the semantic guard, not just the engine-level rejection.
	if key_bytes.is_empty():
		return _hex_hmac_sha256_manual(PackedByteArray(), message.to_utf8_buffer())
	var ctx: HMACContext = HMACContext.new()
	var err: int = ctx.start(HashingContext.HASH_SHA256, key_bytes)
	assert(err == OK, "HMAC start must succeed in test helper")
	err = ctx.update(message.to_utf8_buffer())
	assert(err == OK, "HMAC update must succeed in test helper")
	return ctx.finish().hex_encode()


static func _hex_hmac(key_string: String, message: String) -> String:
	return _hex_hmac_bytes(key_string.to_utf8_buffer(), message)


static func _sha256(data: PackedByteArray) -> PackedByteArray:
	var ctx: HashingContext = HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(data)
	return ctx.finish()


## Manual RFC 2104 HMAC-SHA256 implementation used only to compute a digest
## under an empty key, which the engine's HMACContext refuses to accept.
static func _hex_hmac_sha256_manual(key: PackedByteArray, message: PackedByteArray) -> String:
	const BLOCK_SIZE: int = 64
	var block_key: PackedByteArray = key.duplicate()
	if block_key.size() > BLOCK_SIZE:
		block_key = _sha256(block_key)
	while block_key.size() < BLOCK_SIZE:
		block_key.push_back(0)

	var inner: PackedByteArray = PackedByteArray()
	var outer: PackedByteArray = PackedByteArray()
	inner.resize(BLOCK_SIZE)
	outer.resize(BLOCK_SIZE)
	for i in range(BLOCK_SIZE):
		inner[i] = block_key[i] ^ 0x36
		outer[i] = block_key[i] ^ 0x5C

	var inner_hash: PackedByteArray = _sha256(inner + message)
	return _sha256(outer + inner_hash).hex_encode()


static func _flip_last_key_byte(key_bytes: PackedByteArray) -> PackedByteArray:
	# Returns a copy of the key with the final byte XOR-flipped by one bit.
	# Preserves length so this models a single-byte corruption of the key.
	assert(not key_bytes.is_empty(), "Cannot flip a byte of an empty key")
	var copy: PackedByteArray = key_bytes.duplicate()
	var last: int = key_bytes.size() - 1
	copy[last] = copy[last] ^ 0x01
	return copy


func _make_activator_with_key(key_bytes: PackedByteArray) -> Object:
	var activator: Object = LICENSE_ACTIVATOR_SCRIPT.new()
	activator.set_key_for_testing(key_bytes)
	return activator


# ---------------------------------------------------------------------------
# 1. Correct publisher key
# ---------------------------------------------------------------------------

## Validates: Requirements 32.2
func test_hmac_verifies_with_correct_publisher_key() -> void:
	var key: PackedByteArray = PUBLISHER_KEY_CORRECT.to_utf8_buffer()
	var activator: Object = _make_activator_with_key(key)
	var signature: String = _hex_hmac_bytes(key, LICENSE_ID)
	assert_true(
		activator.verify(LICENSE_ID, signature),
		"Signature produced under the configured publisher key must verify"
	)


# ---------------------------------------------------------------------------
# 2. Modified publisher key
# ---------------------------------------------------------------------------

## Validates: Requirements 32.2, 32.5
func test_hmac_rejects_with_modified_publisher_key_single_byte_flip() -> void:
	var signer_key: PackedByteArray = PUBLISHER_KEY_CORRECT.to_utf8_buffer()
	var verifier_key: PackedByteArray = _flip_last_key_byte(signer_key)
	var signature: String = _hex_hmac_bytes(signer_key, LICENSE_ID)

	var activator: Object = _make_activator_with_key(verifier_key)
	assert_false(
		activator.verify(LICENSE_ID, signature),
		"Signature under correct key must not verify when activator holds a one-byte-flipped key"
	)


## Validates: Requirements 32.2, 32.5
func test_hmac_rejects_with_completely_different_publisher_key() -> void:
	var signer_key: PackedByteArray = PUBLISHER_KEY_CORRECT.to_utf8_buffer()
	var verifier_key: PackedByteArray = PUBLISHER_KEY_ALT.to_utf8_buffer()
	var signature: String = _hex_hmac_bytes(signer_key, LICENSE_ID)

	var activator: Object = _make_activator_with_key(verifier_key)
	assert_false(
		activator.verify(LICENSE_ID, signature),
		"Signature under signer key must not verify when activator holds an unrelated key"
	)


# ---------------------------------------------------------------------------
# 3. Empty publisher key
# ---------------------------------------------------------------------------

## An empty publisher key is a misconfiguration. The verifier must reject
## every input combination, including a signature that was genuinely
## computed under an empty key (which would otherwise be cryptographically
## valid). This asserts the semantic contract, not just the math.
##
## Validates: Requirements 32.2, 32.5
func test_hmac_rejects_when_activator_key_is_empty() -> void:
	var activator: Object = _make_activator_with_key(PackedByteArray())

	var all_zero_hex: String = "0".repeat(64)
	assert_false(
		activator.verify(LICENSE_ID, all_zero_hex),
		"All-zero hex signature must not verify under an empty key"
	)

	var genuine_empty_key_hmac: String = _hex_hmac_bytes(PackedByteArray(), LICENSE_ID)
	assert_false(
		activator.verify(LICENSE_ID, genuine_empty_key_hmac),
		"Signature computed with an empty key must not verify: empty key is never a valid publisher key"
	)

	var wrong_length_non_hex: String = "not-a-valid-hex-signature-of-any-length"
	assert_false(
		activator.verify(LICENSE_ID, wrong_length_non_hex),
		"Malformed signature must not verify under an empty key"
	)


# ---------------------------------------------------------------------------
# Key rotation: default -> test -> empty -> default
# ---------------------------------------------------------------------------

## Validates: Requirements 32.1, 32.2, 32.4
func test_hmac_verifies_with_default_publisher_key_after_reset() -> void:
	var activator: Object = LICENSE_ACTIVATOR_SCRIPT.new()

	# Swap through a test key and an empty key to simulate misconfiguration.
	activator.set_key_for_testing(PUBLISHER_KEY_CORRECT.to_utf8_buffer())
	activator.set_key_for_testing(PackedByteArray())

	# Restore the compiled-in publisher key and check signatures produced
	# with that same default key verify successfully.
	var default_key: String = LICENSE_ACTIVATOR_SCRIPT.PUBLISHER_HMAC_KEY
	activator.set_key_for_testing(default_key.to_utf8_buffer())

	var signature: String = _hex_hmac(default_key, LICENSE_ID)
	assert_true(
		activator.verify(LICENSE_ID, signature),
		"After resetting to the default publisher key, default-key signatures must verify"
	)
