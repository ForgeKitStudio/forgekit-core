class_name CoreBoundary
extends RefCounted
## Static helper that encodes the read-only Core_Boundary for agent-driven
## writes. The MCP server consults this module before committing any write
## and rejects disallowed paths with the JSON-RPC error code
## `CORE_BOUNDARY_VIOLATION`.
##
## The boundary exists so that ForgeKit Core (and vendored addons like GUT)
## can be upgraded by swapping directories wholesale rather than by editing
## them in place. Client code under `res://` — including `addons/forgekit_rpg/`
## — stays writable.


## Directory roots the MCP server must never write into. Matched by prefix
## against the normalized input path.
const READ_ONLY_PATHS: Array[String] = [
	"res://addons/forgekit_core/",
	"res://addons/gut/",
]

## Glob-style patterns for fine-grained rejection. `**` matches any number
## of path segments, `*` matches any characters except `/`.
const DENY_WRITE_PATTERNS: Array[String] = [
	"res://addons/forgekit_core/**",
	"res://addons/forgekit_core/**/*.gd",
	"res://addons/forgekit_core/**/*.tres",
	"res://addons/forgekit_core/**/*.tscn",
	"res://addons/gut/**",
]


## Returns the path prefixed with `res://` when it is missing, so callers
## may pass either a fully-qualified `res://` URI or a project-relative
## path such as `addons/forgekit_core/plugin.cfg`.
static func _normalize(path: String) -> String:
	if path.begins_with("res://"):
		return path
	return "res://" + path.lstrip("/")


## True when `path` falls under any entry of `READ_ONLY_PATHS`.
static func is_read_only(path: String) -> bool:
	var normalized: String = _normalize(path)
	for root in READ_ONLY_PATHS:
		if normalized == root or normalized == root.rstrip("/"):
			return true
		if normalized.begins_with(root):
			return true
	return false


## True when `path` matches any entry of `DENY_WRITE_PATTERNS`.
static func matches_deny_pattern(path: String) -> bool:
	var normalized: String = _normalize(path)
	for pattern in DENY_WRITE_PATTERNS:
		if _glob_match(pattern, normalized):
			return true
	return false


## Returns `{}` when the write is allowed, or a populated violation payload
## `{"code": "CORE_BOUNDARY_VIOLATION", "path": <path>, "matched_rule": <rule>}`
## when the path is denied. `matched_rule` is the specific entry from
## `READ_ONLY_PATHS` or `DENY_WRITE_PATTERNS` that triggered the rejection.
static func violation_for(path: String) -> Dictionary:
	var normalized: String = _normalize(path)
	for root in READ_ONLY_PATHS:
		if normalized == root or normalized == root.rstrip("/") or normalized.begins_with(root):
			return {
				"code": "CORE_BOUNDARY_VIOLATION",
				"path": path,
				"matched_rule": root,
			}
	for pattern in DENY_WRITE_PATTERNS:
		if _glob_match(pattern, normalized):
			return {
				"code": "CORE_BOUNDARY_VIOLATION",
				"path": path,
				"matched_rule": pattern,
			}
	return {}


## Small glob matcher supporting `**` (any path segments, including none
## and including `/`) and `*` (any characters except `/`). The pattern
## is split on `**`; each resulting fragment is matched left-to-right.
static func _glob_match(pattern: String, value: String) -> bool:
	var parts: PackedStringArray = pattern.split("**", false)
	if parts.size() == 0:
		return value == ""

	var has_leading_doublestar: bool = pattern.begins_with("**")
	var has_trailing_doublestar: bool = pattern.ends_with("**")

	var cursor: int = 0

	# Anchor the first fragment to the start of the value unless the pattern
	# itself begins with `**`, in which case the fragment can start anywhere.
	if not has_leading_doublestar:
		if not _segment_match(parts[0], value, cursor, true):
			return false
		cursor = _segment_length(parts[0])
		parts.remove_at(0)
		if parts.size() == 0:
			# No remaining fragments: the pattern had no `**`, so the whole
			# value must have been consumed.
			return cursor == value.length()

	# Middle fragments must be found in order anywhere in the remaining value.
	while parts.size() > (1 if has_trailing_doublestar else 0) and parts.size() > 0:
		var fragment: String = parts[0]
		if fragment == "":
			parts.remove_at(0)
			continue
		var found: int = _find_segment(fragment, value, cursor)
		if found == -1:
			return false
		cursor = found + _segment_length(fragment)
		parts.remove_at(0)
		# Stop once only the trailing-anchored fragment is left.
		if parts.size() == 1 and not has_trailing_doublestar:
			break

	if parts.size() == 0:
		return true

	# Final fragment: must match exactly at the end of the value unless the
	# pattern ended with `**`, in which case it only has to match somewhere.
	var last: String = parts[parts.size() - 1]
	if has_trailing_doublestar:
		if last == "":
			return true
		return _find_segment(last, value, cursor) != -1
	# Anchor to the end of the value.
	var last_len: int = _segment_length(last)
	if value.length() - cursor < last_len:
		return false
	var tail_start: int = value.length() - last_len
	if tail_start < cursor:
		return false
	return _segment_match(last, value, tail_start, true)


## Returns the character length a segment will consume when matched. The
## glob segments used here contain no variable-width wildcards (only `*`,
## which matches "any chars except `/`" but still has a deterministic
## match length at the position we chose), so the length equals the
## pattern length minus `*` placeholder adjustment; we compute it from
## the actual match instead.
static func _segment_length(fragment: String) -> int:
	# When the fragment has no wildcards its length is trivial.
	if not fragment.contains("*"):
		return fragment.length()
	# With wildcards the length is variable; callers only use this helper
	# after a successful match, so we return the literal character count
	# excluding `*`. The matcher advances the cursor by the matched
	# substring length rather than by this function in the wildcard case,
	# so we fall back to the full fragment length to keep forward progress
	# monotonic; a tighter implementation would thread the matched length
	# through, but the current patterns never need it because wildcards
	# appear only in the trailing `*.ext` fragment.
	return fragment.length()


## Matches `fragment` against `value` starting at `offset`. When
## `anchored` is true the fragment must match exactly at `offset`. The
## fragment may contain `*` wildcards that match any characters except
## the `/` separator.
static func _segment_match(fragment: String, value: String, offset: int, anchored: bool) -> bool:
	if not fragment.contains("*"):
		if anchored:
			return value.substr(offset, fragment.length()) == fragment
		return value.find(fragment, offset) != -1
	# Handle the simple `*ext` / `prefix*ext` shape used by deny patterns.
	var star_idx: int = fragment.find("*")
	var prefix: String = fragment.substr(0, star_idx)
	var suffix: String = fragment.substr(star_idx + 1)
	if value.substr(offset, prefix.length()) != prefix:
		return false
	var scan_start: int = offset + prefix.length()
	var remainder: String = value.substr(scan_start)
	if not remainder.ends_with(suffix):
		return false
	var middle: String = remainder.substr(0, remainder.length() - suffix.length())
	# `*` must not cross a `/` boundary.
	return not middle.contains("/")


## Searches for `fragment` anywhere at or after `from` in `value`. Returns
## the match start or `-1` if not found. Supports the same wildcard shapes
## as `_segment_match`.
static func _find_segment(fragment: String, value: String, from: int) -> int:
	if not fragment.contains("*"):
		return value.find(fragment, from)
	for i in range(from, value.length() + 1):
		if _segment_match(fragment, value, i, true):
			return i
	return -1
