extends GutTest
## Unit tests for LicenseStore: persists a verified license record as JSON
## under an injectable base directory, gates writes on the activator's HMAC
## verification, and exposes a round-trip read API.
##
## Tests avoid polluting the real `user://licenses/` directory by pointing
## LicenseStore at a temporary subdirectory (`user://test_licenses/...`) via
## the injectable base-dir setter.


const LICENSE_STORE_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/licensing/license_store.gd")
const LICENSE_ACTIVATOR_SCRIPT: GDScript = preload("res://addons/forgekit_core/mcp/licensing/license_activator.gd")

const TEST_KEY: String = "test-publisher-key-forgekit"
const TEST_MODULE_ID: String = "forgekit_rpg"
const TEST_LICENSE_ID: String = "forgekit_rpg-customer-12345"

const TEST_BASE_DIR: String = "user://test_licenses_store/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

static func _hex_hmac(key: String, message: String) -> String:
	var ctx: HMACContext = HMACContext.new()
	var err: int = ctx.start(HashingContext.HASH_SHA256, key.to_utf8_buffer())
	assert(err == OK, "HMAC start must succeed in test helper")
	err = ctx.update(message.to_utf8_buffer())
	assert(err == OK, "HMAC update must succeed in test helper")
	return ctx.finish().hex_encode()


func _remove_dir_recursive(path: String) -> void:
	var absolute: String = ProjectSettings.globalize_path(path)
	var dir: DirAccess = DirAccess.open(absolute)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry_name: String = dir.get_next()
	while entry_name != "":
		var entry_path: String = path + entry_name
		if dir.current_is_dir():
			_remove_dir_recursive(entry_path + "/")
		else:
			dir.remove(entry_name)
		entry_name = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(absolute)


func _make_activator() -> Object:
	var activator: Object = LICENSE_ACTIVATOR_SCRIPT.new()
	activator.set_key_for_testing(TEST_KEY.to_utf8_buffer())
	return activator


func _make_store() -> Object:
	var store: Object = LICENSE_STORE_SCRIPT.new()
	store.set_activator(_make_activator())
	store.set_base_dir(TEST_BASE_DIR)
	return store


func _read_file(path: String) -> String:
	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var text: String = f.get_as_text()
	f.close()
	return text


func _parse_json(text: String) -> Variant:
	var parser: JSON = JSON.new()
	var err: int = parser.parse(text)
	assert_eq(err, OK, "Persisted license payload must parse as JSON")
	return parser.data


func before_each() -> void:
	_remove_dir_recursive(TEST_BASE_DIR)


func after_each() -> void:
	_remove_dir_recursive(TEST_BASE_DIR)


# ---------------------------------------------------------------------------
# activate(): successful verification writes a well-formed record
# ---------------------------------------------------------------------------

func test_activate_with_valid_signature_writes_json_with_three_required_fields() -> void:
	var store: Object = _make_store()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)

	var result: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)

	assert_true(result.get("activated", false), "activate() must succeed for a valid HMAC")

	var expected_path: String = TEST_BASE_DIR + TEST_MODULE_ID + ".key"
	assert_true(
		FileAccess.file_exists(expected_path),
		"License file must be written at %s" % expected_path
	)

	var payload: Variant = _parse_json(_read_file(expected_path))
	assert_true(payload is Dictionary, "Persisted payload must be a JSON object")
	var record: Dictionary = payload
	assert_true(record.has("license_id"), "Record must contain license_id")
	assert_true(record.has("activated_at"), "Record must contain activated_at")
	assert_true(record.has("fingerprint"), "Record must contain fingerprint")

	assert_eq(record["license_id"], TEST_LICENSE_ID, "license_id must round-trip exactly")
	assert_true(
		(record["activated_at"] as String).length() >= 19,
		"activated_at must be a non-empty ISO 8601 timestamp"
	)
	assert_false(
		(record["fingerprint"] as String).is_empty(),
		"fingerprint must be non-empty"
	)


# ---------------------------------------------------------------------------
# load_license(): round-trips the written record
# ---------------------------------------------------------------------------

func test_load_license_round_trips_the_written_record() -> void:
	var store: Object = _make_store()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	var activate_result: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)
	assert_true(activate_result.get("activated", false), "Setup: activation must succeed")

	var loaded: Variant = store.load_license(TEST_MODULE_ID)

	assert_true(loaded is Dictionary, "load_license must return a Dictionary after activation")
	var record: Dictionary = loaded
	assert_eq(record.get("license_id", ""), TEST_LICENSE_ID, "license_id must round-trip via load_license")
	assert_eq(
		record.get("activated_at", ""),
		(activate_result.get("record", {}) as Dictionary).get("activated_at", ""),
		"activated_at returned by load_license must equal the value written during activate"
	)
	assert_eq(
		record.get("fingerprint", ""),
		(activate_result.get("record", {}) as Dictionary).get("fingerprint", ""),
		"fingerprint returned by load_license must equal the value written during activate"
	)


func test_load_license_returns_null_when_no_file_exists() -> void:
	var store: Object = _make_store()
	var loaded: Variant = store.load_license(TEST_MODULE_ID)
	assert_eq(loaded, null, "load_license must return null when no license is stored")


# ---------------------------------------------------------------------------
# activate(): failed HMAC verification does NOT write the file
# ---------------------------------------------------------------------------

func test_activate_with_invalid_signature_does_not_write_file() -> void:
	var store: Object = _make_store()
	# 64 hex chars of "0" is length-valid but cannot match any genuine HMAC
	# output for TEST_LICENSE_ID under TEST_KEY.
	var bogus_signature: String = "0".repeat(64)

	var result: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, bogus_signature)

	assert_false(result.get("activated", true), "activate() must fail when HMAC verification fails")
	var expected_path: String = TEST_BASE_DIR + TEST_MODULE_ID + ".key"
	assert_false(
		FileAccess.file_exists(expected_path),
		"License file must not be written when HMAC verification fails"
	)
	assert_eq(
		store.load_license(TEST_MODULE_ID),
		null,
		"load_license must return null after a failed activation"
	)


# ---------------------------------------------------------------------------
# activate(): failed HMAC verification leaves no file at all in the base dir
# ---------------------------------------------------------------------------

## Lists every regular file (including temp files and any sibling files)
## under `path` recursively. Returns an empty array when the directory is
## absent. Used to assert that a failed activation does not leak *any*
## artifact — not just the target `.key` file, but also stray `.tmp` files
## from the atomic writer.
func _list_all_files_recursive(path: String) -> Array[String]:
	var out: Array[String] = []
	var absolute: String = ProjectSettings.globalize_path(path)
	var dir: DirAccess = DirAccess.open(absolute)
	if dir == null:
		return out
	dir.list_dir_begin()
	var entry_name: String = dir.get_next()
	while entry_name != "":
		var entry_path: String = path + entry_name
		if dir.current_is_dir():
			out.append_array(_list_all_files_recursive(entry_path + "/"))
		else:
			out.append(entry_path)
		entry_name = dir.get_next()
	dir.list_dir_end()
	return out


func test_activate_with_invalid_signature_leaves_base_dir_without_any_file() -> void:
	var store: Object = _make_store()
	var bogus_signature: String = "0".repeat(64)

	var result: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, bogus_signature)
	assert_false(result.get("activated", true), "Setup: activate() must fail for a bogus signature")

	var files: Array[String] = _list_all_files_recursive(TEST_BASE_DIR)
	assert_eq(
		files.size(),
		0,
		"Failed activation must not create any file under the base dir (got %s)" % str(files)
	)


# ---------------------------------------------------------------------------
# activate(): re-activation overwrites with a fresh activated_at
# ---------------------------------------------------------------------------

## Injectable clock so the two re-activation timestamps are guaranteed to
## differ without sleeping the test process through a whole second.
class FixedClock:
	extends RefCounted

	var _values: Array = []
	var _index: int = 0

	func _init(values: Array) -> void:
		_values = values

	func now() -> String:
		var v: String = _values[_index] as String
		if _index < _values.size() - 1:
			_index += 1
		return v


func test_activate_overwrites_existing_license_with_fresh_activated_at() -> void:
	var store: Object = _make_store()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)
	var clock: FixedClock = FixedClock.new([
		"2024-01-01T00:00:00",
		"2024-06-15T12:30:45",
	])
	store.set_clock_for_testing(Callable(clock, "now"))

	var first: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)
	assert_true(first.get("activated", false), "First activation must succeed")
	var first_record: Dictionary = first.get("record", {})

	var second: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)
	assert_true(second.get("activated", false), "Re-activation must succeed")
	var second_record: Dictionary = second.get("record", {})

	assert_eq(
		first_record.get("activated_at", ""),
		"2024-01-01T00:00:00",
		"First activation must use the first clock value"
	)
	assert_eq(
		second_record.get("activated_at", ""),
		"2024-06-15T12:30:45",
		"Re-activation must use a fresh activated_at from the clock"
	)

	var loaded: Variant = store.load_license(TEST_MODULE_ID)
	assert_true(loaded is Dictionary, "Stored record must be readable after overwrite")
	assert_eq(
		(loaded as Dictionary).get("activated_at", ""),
		"2024-06-15T12:30:45",
		"Persisted activated_at must reflect the latest activation, not the first"
	)


# ---------------------------------------------------------------------------
# fingerprint determinism
# ---------------------------------------------------------------------------

func test_fingerprint_is_non_empty_and_deterministic_across_activations() -> void:
	var store: Object = _make_store()
	var signature: String = _hex_hmac(TEST_KEY, TEST_LICENSE_ID)

	var first: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)
	var second: Dictionary = store.activate(TEST_MODULE_ID, TEST_LICENSE_ID, signature)

	var fp1: String = (first.get("record", {}) as Dictionary).get("fingerprint", "")
	var fp2: String = (second.get("record", {}) as Dictionary).get("fingerprint", "")

	assert_false(fp1.is_empty(), "fingerprint must be non-empty")
	assert_eq(fp1, fp2, "fingerprint must be deterministic across activations for the same machine")
