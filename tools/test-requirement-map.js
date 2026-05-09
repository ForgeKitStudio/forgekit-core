/**
 * Manifest mapping of repo-relative test files to the acceptance
 * criteria they exercise. Read by `generate-coverage-matrix.js` as an
 * additive data source — any test file that carries `_Wymagania:` or
 * `Validates:` annotations in its own header wins by itself and does
 * not need a manifest entry. Kept separate from the test bodies so
 * adding coverage does not churn every test file.
 *
 * Criteria are listed as `<requirement>.<criterion>` tokens. A file
 * may cover multiple requirements. The generator deduplicates and
 * sorts automatically.
 */

export const TEST_REQUIREMENT_MAP = {
    'tests/static/test_core_rpg_separation.gd': [
        '1.1', '1.2', '1.3', '1.5',
    ],
    'mcp-server/test/property_check_imports.test.ts': [
        '1.2', '1.3', '1.4', '7.2',
    ],
    'tests/unit/test_game_events.gd': [
        '2.1', '2.2', '2.3', '2.4', '2.5',
        '56.1', '56.2', '56.3', '56.4',
        '66.1', '66.2', '66.3', '66.4',
    ],
    'tests/property/test_event_bus_propagation.gd': ['2.3'],
    'tests/property/test_event_bus_type_validation.gd': ['2.4'],
    'tests/unit/test_item_resource.gd': [
        '3.1', '3.3', '3.4', '3.5',
    ],
    'tests/unit/test_recipe_resource.gd': [
        '3.2', '3.3', '3.4', '3.5',
    ],
    'tests/unit/test_equipable_item_resource.gd': ['3.1'],
    'tests/property/test_item_resource_roundtrip.gd': ['3.3', '3.4'],
    'tests/property/test_recipe_resource_roundtrip.gd': ['3.3', '3.4'],
    'tests/property/test_tres_field_detection.gd': ['3.5', '15.2'],
    'tests/unit/test_tres_loader.gd': ['3.3', '3.4', '3.5'],
    'tests/unit/test_core_boundary.gd': [
        '4.1', '4.2', '4.3', '4.4', '4.5',
    ],
    'mcp-server/test/property_core_boundary.test.ts': ['4.3', '4.4', '4.5'],
    'tests/unit/test_scene_tools_editor.gd': ['5.1', '5.2'],
    'tests/unit/test_node_tools_editor.gd': ['5.1', '5.2', '5.3'],
    'tests/unit/test_resource_tools_editor.gd': ['5.1', '5.2'],
    'tests/unit/test_script_tools_editor.gd': ['5.1', '5.2'],
    'tests/unit/test_editor_tools.gd': ['5.1', '5.2', '5.7'],
    'tests/unit/test_batch_tools.gd': ['5.9', '35.1', '35.2'],
    'tests/unit/test_refactor_tools.gd': ['5.9', '35.3', '35.4', '35.5'],
    'tests/unit/test_transaction_tools.gd': [
        '5.6', '25.1', '25.3', '25.4',
    ],
    'tests/unit/test_transaction_manager.gd': [
        '25.1', '25.2', '25.3', '25.4', '25.5', '25.6',
    ],
    'tests/property/test_transaction_single_undo.gd': ['25.2', '25.3'],
    'tests/property/test_node_property_roundtrip.gd': ['5.3'],
    'mcp-server/test/property_file_not_found.test.ts': ['5.5'],
    'tests/unit/test_mcp_editor_plugin.gd': ['5.1', '5.2', '5.10'],
    'tests/unit/test_animation_tools.gd': ['5.10'],
    'tests/unit/test_animation_tree_tools.gd': ['5.10'],
    'tests/unit/test_tilemap_tools.gd': ['5.10'],
    'tests/unit/test_theme_ui_tools.gd': ['5.10'],
    'tests/unit/test_shader_tools.gd': ['5.10'],
    'tests/unit/test_physics_tools_editor.gd': ['5.10'],
    'tests/unit/test_scene3d_tools.gd': ['5.10'],
    'tests/unit/test_particle_tools.gd': ['5.10'],
    'tests/unit/test_navigation_tools.gd': ['5.10'],
    'tests/unit/test_audio_tools.gd': ['5.10'],
    'tests/unit/test_state_machine_tools.gd': ['5.10'],
    'tests/unit/test_blend_tree_tools.gd': ['5.10'],
    'tests/unit/test_undo_redo_wrapper.gd': [
        '6.1', '6.2', '6.3', '6.4', '6.5',
    ],
    'tests/property/test_undo_snapshot_roundtrip.gd': ['6.3'],
    'tests/unit/test_gdscript_validator.gd': [
        '7.3', '9.1', '9.2', '9.4',
    ],
    'mcp-server/test/property_gdscript_validator.test.ts': [
        '7.3', '9.1', '9.2',
    ],
    'mcp-server/test/property_save_iff_valid.test.ts': ['7.4', '9.2'],
    'tests/unit/test_script_writer.gd': ['9.1', '9.3'],
    'tests/unit/test_mcp_bridge.gd': [
        '8.1', '8.2', '8.3', '8.5', '8.7',
    ],
    'tests/unit/test_packet_parser.gd': ['8.6'],
    'tests/unit/test_udp_server.gd': ['8.2', '8.5', '8.6'],
    'tests/unit/test_input_tools_runtime.gd': ['8.9'],
    'tests/unit/test_input_tools_editor.gd': ['5.2'],
    'tests/unit/test_runtime_input_backend.gd': ['8.9'],
    'mcp-server/test/property_input_simulator.test.ts': ['8.9'],
    'mcp-server/test/property_udp_packet_too_large.test.ts': ['8.6'],
    'tests/unit/test_eval_tools_runtime.gd': ['8.10'],
    'tests/unit/test_event_tools_runtime.gd': ['8.3'],
    'tests/unit/test_info_tools_runtime.gd': ['8.7'],
    'tests/unit/test_diagnostic_tools_runtime.gd': ['8.7'],
    'tests/unit/test_profiling_tools_runtime.gd': ['8.8'],
    'tests/unit/test_profiling_frame_stats_runtime.gd': ['8.8'],
    'mcp-server/test/tools/runtime_bridge/profiling_get_performance_monitors.test.ts': ['8.8'],
    'mcp-server/test/tools/runtime_bridge/profiling_get_frame_stats.test.ts': ['8.8'],
    'mcp-server/test/tools/runtime_bridge/handshake.test.ts': ['8.7', '33.2'],
    'tests/unit/test_time_tools_runtime.gd': ['8.7'],
    'tests/unit/test_runtime_scene_tools.gd': ['8.3'],
    'tests/unit/test_scene_tools_runtime.gd': ['8.3'],
    'tests/unit/test_scene_control_tools_runtime.gd': ['8.3'],
    'tests/unit/test_node_tools_runtime.gd': ['8.3'],
    'tests/unit/test_navigation_tools_runtime.gd': ['8.3'],
    'tests/unit/test_physics_tools_runtime.gd': ['8.3'],
    'tests/unit/test_audio_tools_runtime.gd': ['8.3'],
    'tests/unit/test_state_machine_tools_runtime.gd': ['8.3'],
    'tests/unit/test_test_report.gd': [
        '12.3', '12.4', '12.5', '14.1', '14.2', '14.3', '14.4',
    ],
    'mcp-server/test/property_testreport_roundtrip.test.ts': ['12.5', '14.4'],
    'mcp-server/test/property_suggested_action_set.test.ts': ['14.5'],
    'mcp-server/test/tools/testing/run_suite.test.ts': [
        '7.1', '7.2', '7.5', '12.2', '12.3',
    ],
    'mcp-server/test/tools/testing/run_unit.test.ts': [
        '7.1', '7.2', '7.5', '12.2', '12.3',
    ],
    'mcp-server/test/tools/testing/run_gameplay.test.ts': [
        '7.1', '7.5', '7.6', '13.1', '13.5',
    ],
    'mcp-server/test/tools/testing/run_property.test.ts': [
        '7.1', '7.5', '7.7',
    ],
    'mcp-server/test/tools/testing/gameplay_test_runner.test.ts': [
        '13.1', '13.2', '13.5',
    ],
    'mcp-server/test/tools/testing/test_report.test.ts': [
        '12.4', '12.5', '14.1', '14.2', '14.3', '14.4',
    ],
    'tests/unit/test_healing_inspector.gd': ['15.1', '15.2'],
    'tests/unit/test_healing_suggester.gd': ['15.2', '15.3'],
    'tests/unit/test_healing_tools.gd': ['15.4'],
    'tests/unit/test_retry_counter.gd': ['15.5'],
    'tests/property/test_healing_retry_limit.gd': ['15.5'],
    'mcp-server/test/property_resource_inspect.test.ts': ['15.2', '15.3'],
    'mcp-server/test/property_apply_fix_undo.test.ts': ['15.4'],
    'tests/unit/test_module_manifest.gd': [
        '16.2', '17.1', '17.2', '17.3', '33.1', '33.4',
    ],
    'tests/unit/test_module_loader.gd': [
        '16.3', '16.4', '16.5', '17.1', '17.3', '17.4', '33.4', '33.5',
    ],
    'tests/property/test_core_module_subsets.gd': ['17.5', '1.5'],
    'mcp-server/test/property_list_modules_fields.test.ts': [
        '17.4', '17.5', '37.5', '39.5',
    ],
    'mcp-server/test/tools/modules/enable.test.ts': ['17.2', '17.3'],
    'mcp-server/test/tools/modules/disable.test.ts': ['17.2'],
    'mcp-server/test/tools/modules/inspect_manifest.test.ts': ['17.1', '17.3'],
    'mcp-server/test/tools/modules/check_compatibility.test.ts': [
        '17.4', '33.3', '33.4', '33.5', '38.6',
    ],
    'mcp-server/test/tools/modules/core_version.test.ts': [
        '33.1', '33.2', '33.4', '46.4',
    ],
    'mcp-server/test/tools/modules/activate_license_failure_contract.test.ts': ['32.6'],
    'tests/unit/test_license_activator.gd': ['32.3', '32.6'],
    'tests/unit/test_license_activator_hmac.gd': ['32.3', '32.4'],
    'tests/unit/test_license_store.gd': ['32.3', '32.5'],
    'tests/unit/test_json_rpc_auth.gd': ['18.4', '18.5'],
    'tests/unit/test_json_rpc_dispatcher.gd': ['5.1', '18.4'],
    'tests/unit/test_json_rpc_errors.gd': ['8.6', '18.5'],
    'mcp-server/test/property_auth_token.test.ts': ['18.4', '18.5'],
    'mcp-server/test/property_external_bind.test.ts': [
        '18.1', '18.2', '18.3',
    ],
    'mcp-server/test/profiles.test.ts': [
        '19.1', '19.3', '19.4',
        '20.1', '20.2', '20.3', '20.4',
        '51.4', '57.2', '67.10',
    ],
    'mcp-server/test/profiles_crafting.test.ts': ['19.2', '20.4'],
    'mcp-server/test/profiles_inventory.test.ts': ['19.2', '20.4'],
    'mcp-server/test/profile_flag_validation.test.ts': [
        '20.1', '20.2', '20.3', '20.4', '20.5',
    ],
    'mcp-server/test/stdio_bridge.test.ts': [
        '21.1', '21.2', '21.3', '21.4', '21.5',
    ],
    'mcp-server/test/index_cli.test.ts': ['21.1', '30.4'],
    'mcp-server/test/port_scanner.test.ts': [
        '18.6', '18.7', '22.1', '22.2', '22.3', '22.4', '22.5', '22.6', '22.7',
    ],
    'mcp-server/test/port_scanner_excluded.test.ts': [
        '18.6', '22.1', '22.2', '70.3', '70.4',
    ],
    'mcp-server/test/property_port_isolation.test.ts': [
        '18.6', '22.1', '22.2', '22.3', '22.4', '70.3', '74.2',
    ],
    'mcp-server/test/auto_reconnect.test.ts': ['23.3', '23.4', '23.5'],
    'tests/unit/test_heartbeat_monitor.gd': ['23.1', '23.2'],
    'tests/unit/test_project_settings_atomic_writer.gd': [
        '24.1', '24.2', '24.3', '24.4', '24.5',
    ],
    'mcp-server/test/property_project_settings_atomic.test.ts': ['24.1', '24.2'],
    'mcp-server/test/type_parser.test.ts': [
        '26.1', '26.2', '26.3', '26.4', '26.5',
    ],
    'tests/unit/test_visualizer_http_server.gd': ['27.1', '27.5', '27.6'],
    'tests/unit/test_visualizer_tools.gd': [
        '27.1', '27.2', '27.3', '27.4', '27.5',
    ],
    'tests/unit/test_asset_generator_tools.gd': [
        '28.1', '28.2', '28.3', '28.4', '28.5',
    ],
    'tests/unit/test_icon_set_generator.gd': ['28.4'],
    'tests/unit/test_noise_generator.gd': ['28.3'],
    'tests/unit/test_svg_rasterizer.gd': ['28.1'],
    'tests/unit/test_texture_packer.gd': ['28.2'],
    'tests/unit/test_jsonl_logger.gd': ['30.1', '30.2', '30.3'],
    'mcp-server/test/observability/trace.test.ts': ['30.1', '30.2', '30.3'],
    'mcp-server/test/observability/jsonl_logger_reserved_fields.test.ts': [
        '30.2', '73.5',
    ],
    'mcp-server/test/metrics.test.ts': ['30.5'],
    'mcp-server/test/health_endpoint.test.ts': [
        '18.8', '22.4', '31.1', '31.2', '31.3', '31.4', '31.5', '31.6', '72.5',
    ],
    'mcp-server/test/property_semver_compat.test.ts': [
        '17.4', '33.1', '33.4', '33.5',
    ],
    'mcp-server/test/property_tag_compatibility.test.ts': [
        '33.1', '33.3', '33.4', '33.5',
    ],
    'mcp-server/test/property_tag_core_min_version.test.ts': [
        '33.4', '33.5', '44.2', '44.3',
    ],
    'tests/unit/test_update_checker.gd': ['38.1', '38.2'],
    'mcp-server/test/tools/export/list_presets.test.ts': ['7.8', '36.1'],
    'mcp-server/test/tools/export/run_preset.test.ts': ['7.8', '36.2'],
    'mcp-server/test/tools/export/validate_preset.test.ts': ['7.8', '36.3'],
    'mcp-server/test/tools/android/list_devices.test.ts': ['7.9', '36.4'],
    'mcp-server/test/tools/android/install_apk.test.ts': ['7.9', '36.5'],
    'mcp-server/test/tools/android/run_logcat.test.ts': ['7.9', '36.6'],
    'mcp-server/test/property_context_sync.test.ts': ['40.1', '40.2', '40.3'],
    'mcp-server/test/pre_commit_context.test.ts': ['40.1', '40.2', '40.3'],
    'mcp-server/test/install_hooks.test.ts': ['40.1', '41.5'],
    'mcp-server/test/cli_install_hooks.test.ts': ['40.1', '41.5'],
    'mcp-server/test/property_conventional_commits.test.ts': [
        '40.4', '40.5', '41.1', '41.2', '41.3',
    ],
    'mcp-server/test/commit_msg_validator.test.ts': [
        '40.4', '40.5', '41.1', '41.3',
    ],
    'mcp-server/test/check_pr_template.test.ts': [
        '42.1', '42.2', '42.3', '42.4', '42.5', '42.7',
    ],
    'mcp-server/test/validate_language_policy.test.ts': ['43.6'],
    'mcp-server/test/validate_release_tag.test.ts': ['43.7', '44.4', '46.1'],
    'mcp-server/test/ci_workflows.test.ts': [
        '43.1', '43.2', '43.3', '43.4', '43.5', '43.7', '43.8',
    ],
    'mcp-server/test/profile_tool_counts.test.ts': [
        '19.1', '19.3', '19.4',
        '20.1', '20.2', '20.3', '20.4',
        '51.4', '57.2', '67.10', '67.11',
    ],
    'mcp-server/test/documentation_contracts.test.ts': [
        '5.4', '38.3', '38.4', '38.5', '39.3', '42.6',
    ],
    'mcp-server/test/licensing/license_directory.test.ts': [
        '32.3', '32.5', '32.6',
    ],
    'mcp-server/test/licensing/per_workspace_license_dir.test.ts': ['32.3'],
    'mcp-server/test/tools/search/search_code.test.ts': ['5.8'],
    'mcp-server/test/tools/search/search_references.test.ts': ['5.8'],
    'mcp-server/test/tools/analysis/count_nodes_by_type.test.ts': ['5.8'],
    'mcp-server/test/tools/analysis/dependency_graph.test.ts': ['5.8'],
    'tests/integration/test_crafting_scenario.gd': [
        '13.1', '13.2', '13.3', '13.5',
    ],
    'tests/unit/test_editor_plugin_lifecycle.gd': ['5.1', '5.2', '19.5'],
    'tests/unit/test_websocket_server.gd': ['5.1', '18.1'],
    // Smoke tests — lock down filesystem contract
    'tests/smoke/test_core_layout.gd': ['1.1', '2.1', '3.1', '3.2', '16.1'],
    'tests/smoke/test_autoload_exists.gd': ['2.1', '8.1'],
    'tests/smoke/test_notice_md.gd': [
        '17.3', '37.1', '37.2', '37.3', '37.4', '37.5', '39.2', '39.4', '39.5',
    ],
    'tests/smoke/test_spec_artifacts.gd': [
        '4.1', '4.2', '12.1',
        '29.1', '29.2', '29.3', '29.4',
        '39.1', '39.4',
        '45.1', '45.2', '45.3', '45.4', '45.5',
    ],

    // ---------------------------------------------------------------------
    // Cross-repo coverage — tests that live in `ForgeKitStudio/forgekit-rpg`
    // but verify requirements defined in the ForgeKit spec. Paths are
    // resolved relative to the forgekit-core repo root; existence checks
    // confirm the sibling repo is present before counting coverage.
    // ---------------------------------------------------------------------

    // Req 8 — Runtime bridge inventory behavior
    '../forgekit-rpg/tests/unit/test_inventory_system.gd': [
        '8.3', '8.4',
    ],
    '../forgekit-rpg/tests/unit/test_inventory_tools_runtime.gd': [
        '8.3', '8.4',
    ],
    '../forgekit-rpg/tests/property/test_inventory_commutativity.gd': [
        '8.4',
    ],

    // Req 10 — Combat system (Hitbox / Hurtbox / StateMachine)
    '../forgekit-rpg/tests/unit/test_hitbox_hurtbox.gd': [
        '10.1', '10.2', '10.4',
    ],
    '../forgekit-rpg/tests/unit/test_state_machine.gd': ['10.3'],
    '../forgekit-rpg/tests/unit/test_combat_tools_runtime.gd': [
        '10.1', '10.2', '10.5',
    ],
    '../forgekit-rpg/tests/property/test_hitbox_hurtbox_team.gd': [
        '10.2', '10.4',
    ],
    '../forgekit-rpg/tests/property/test_state_machine_identity.gd': [
        '10.3',
    ],

    // Req 11 — Crafting manager
    '../forgekit-rpg/tests/unit/test_crafting_manager.gd': [
        '11.1', '11.2', '11.3', '11.4', '11.5',
    ],
    '../forgekit-rpg/tests/unit/test_crafting_tools_runtime.gd': [
        '11.1', '11.2', '11.4', '11.5',
    ],
    '../forgekit-rpg/tests/unit/test_recipe_generator.gd': ['11.6'],
    '../forgekit-rpg/tests/unit/test_recipe_iron_ingot_example.gd': ['11.6'],
    '../forgekit-rpg/tests/property/test_crafting_balance.gd': [
        '11.2', '11.4',
    ],
    '../forgekit-rpg/tests/property/test_crafting_no_mutation_on_failure.gd': [
        '11.3', '11.5',
    ],

    // Req 13 — Gameplay scenarios input simulator hook-up
    '../forgekit-rpg/tests/integration/test_combat_demo_scene.gd': [
        '13.1', '13.4', '13.5',
    ],
    '../forgekit-rpg/tests/integration/test_combat_death_loot_xp_full_scenario.gd': [
        '13.1', '13.4', '13.5',
    ],

    // Req 34 — Stats system (modifiers, determinism)
    '../forgekit-rpg/tests/unit/test_stats_system.gd': [
        '34.1', '34.2', '34.3', '34.4', '34.5',
    ],
    '../forgekit-rpg/tests/unit/test_stats_tools_runtime.gd': [
        '34.1', '34.2', '34.3', '34.5',
    ],

    // Req 47 — ResourcePool
    '../forgekit-rpg/tests/unit/test_resource_pool.gd': [
        '47.1', '47.2', '47.3', '47.4', '47.5',
    ],
    '../forgekit-rpg/tests/property/test_resource_pool_roundtrip.gd': [
        '47.6',
    ],

    // Req 48 — Status effect system
    '../forgekit-rpg/tests/unit/test_status_effect_resource.gd': [
        '48.1', '48.2',
    ],
    '../forgekit-rpg/tests/unit/test_status_effect_manager.gd': [
        '48.1', '48.3', '48.4', '48.6',
    ],
    '../forgekit-rpg/tests/unit/test_status_effect_ticker_autoload.gd': [
        '48.4', '48.5',
    ],
    '../forgekit-rpg/tests/unit/test_effects_tools_runtime.gd': [
        '48.1', '48.3', '48.4',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_tick_sum.gd': [
        '48.4',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_refresh.gd': [
        '48.6',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_commutativity.gd': [
        '48.4',
    ],

    // Req 49 — Spell system
    '../forgekit-rpg/tests/unit/test_spell_resource.gd': [
        '49.1', '49.2',
    ],
    '../forgekit-rpg/tests/unit/test_spell_caster.gd': [
        '49.1', '49.4', '49.5', '49.6', '49.7', '49.8',
    ],
    '../forgekit-rpg/tests/unit/test_cast_result.gd': ['49.3'],
    '../forgekit-rpg/tests/unit/test_magic_tools_runtime.gd': [
        '49.1', '49.3', '49.4', '49.5', '49.6', '51.2',
    ],
    '../forgekit-rpg/tests/property/test_magic_cast_gate.gd': [
        '49.4', '49.5', '49.6', '52.4',
    ],

    // Req 50 — Equipment system + EquipableItemResource
    '../forgekit-rpg/tests/unit/test_equipment_system.gd': [
        '50.1', '50.2', '50.3', '50.4', '50.5', '50.6', '50.7', '50.8',
    ],
    '../forgekit-rpg/tests/unit/test_equip_result.gd': ['50.5', '50.6'],
    '../forgekit-rpg/tests/unit/test_equipment_tools_runtime.gd': [
        '50.3', '50.5', '50.6', '50.7', '50.8', '51.3',
    ],
    '../forgekit-rpg/tests/property/test_equipment_roundtrip.gd': [
        '50.9', '52.3',
    ],

    // Req 51 — MCP tools for effects / magic / equipment
    '../forgekit-rpg/tests/unit/test_builtin_status_effects.gd': ['51.1'],
    '../forgekit-rpg/tests/unit/test_builtin_spells.gd': ['51.2'],
    '../forgekit-rpg/tests/unit/test_builtin_equipable_items.gd': [
        '3.1', '50.1', '50.2', '51.3',
    ],
    '../forgekit-rpg/tests/unit/test_module_scaffold.gd': [
        '17.1', '17.2', '17.3', '51.4', '51.5',
    ],

    // Req 52 — Correctness properties fazy 4B (35-40)
    '../forgekit-rpg/tests/property/test_resource_pool_roundtrip.gd': [
        '47.6', '52.1',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_tick_sum.gd': [
        '48.4', '52.2',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_refresh.gd': [
        '48.6', '52.5',
    ],
    '../forgekit-rpg/tests/property/test_status_effect_commutativity.gd': [
        '48.4', '52.6',
    ],

    // Req 53 — XpCurveResource
    '../forgekit-rpg/tests/unit/test_xp_curve_resource.gd': [
        '53.1', '53.2', '53.3', '53.4', '53.5',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_xp_curves.gd': ['53.6'],

    // Req 54 — LevelUpRewardResource
    '../forgekit-rpg/tests/unit/test_level_up_reward_resource.gd': [
        '54.1', '54.2', '54.3',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_level_up_rewards.gd': ['54.4'],
    '../forgekit-rpg/tests/unit/test_level_up_result.gd': ['55.4'],

    // Req 55 — XPSystem
    '../forgekit-rpg/tests/unit/test_xp_system.gd': [
        '55.1', '55.2', '55.3', '55.4', '55.5', '55.6', '55.7', '55.8',
    ],
    '../forgekit-rpg/tests/unit/test_progression_tools_runtime.gd': [
        '55.1', '55.3', '55.4', '55.5', '57.1', '57.3',
    ],
    '../forgekit-rpg/tests/property/test_death_triggers_xp.gd': [
        '56.3', '56.5', '66.5', '68.4',
    ],

    // Req 57 — progression.* MCP tools
    // (covered via test_progression_tools_runtime.gd mapping above)

    // Req 58 — Correctness properties fazy 5 (41-43)
    '../forgekit-rpg/tests/property/test_xp_curve_monotonic.gd': ['58.1'],
    '../forgekit-rpg/tests/property/test_xp_curve_inverse.gd': ['58.2'],
    '../forgekit-rpg/tests/property/test_xp_system_additivity.gd': ['58.3'],

    // Req 59 — EnemyResource extended
    '../forgekit-rpg/tests/unit/test_enemy_resource.gd': [
        '59.1', '59.2',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_enemies.gd': ['59.3'],

    // Req 60 — EnemyController + AI states + profiles
    '../forgekit-rpg/tests/unit/test_enemy_controller.gd': [
        '60.1', '60.5', '60.6',
    ],
    '../forgekit-rpg/tests/unit/test_ai_state_base.gd': ['60.2'],
    '../forgekit-rpg/tests/unit/test_ai_states.gd': ['60.3'],
    '../forgekit-rpg/tests/unit/test_ai_profiles.gd': ['60.4'],

    // Req 61 — LootEntry + LootTableResource + LootRoller
    '../forgekit-rpg/tests/unit/test_loot_resources.gd': [
        '61.1', '61.2', '61.3',
    ],
    '../forgekit-rpg/tests/unit/test_loot_roller.gd': [
        '61.4', '61.5', '61.6',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_loot_tables.gd': ['61.7'],
    '../forgekit-rpg/tests/unit/test_loot_tools_runtime.gd': [
        '61.4', '61.5', '67.2',
    ],
    '../forgekit-rpg/tests/property/test_loot_roller_deterministic.gd': [
        '61.5', '68.1',
    ],
    '../forgekit-rpg/tests/property/test_loot_roller_chance.gd': [
        '61.6', '68.2',
    ],

    // Req 62 — EnemySpawner + WaveResource
    '../forgekit-rpg/tests/unit/test_enemy_spawner.gd': [
        '62.1', '62.3', '62.4', '62.5',
    ],
    '../forgekit-rpg/tests/unit/test_wave_resource.gd': ['62.2'],
    '../forgekit-rpg/tests/unit/test_builtin_waves.gd': ['62.6'],
    '../forgekit-rpg/tests/unit/test_spawner_tools_runtime.gd': [
        '62.1', '62.3', '62.5', '67.3',
    ],
    '../forgekit-rpg/tests/property/test_spawner_budget.gd': [
        '62.3', '68.3',
    ],

    // Req 63 — World interactables
    '../forgekit-rpg/tests/unit/test_item_pickup.gd': ['63.1'],
    '../forgekit-rpg/tests/unit/test_interactable_area.gd': ['63.2'],
    '../forgekit-rpg/tests/unit/test_treasure_chest.gd': [
        '63.3', '67.4',
    ],
    '../forgekit-rpg/tests/unit/test_door.gd': ['63.4'],
    '../forgekit-rpg/tests/unit/test_portal.gd': ['63.5'],
    '../forgekit-rpg/tests/unit/test_world_tools_runtime.gd': [
        '63.1', '63.2', '63.3', '63.4', '63.5', '67.4',
    ],

    // Req 64 — NPC + Dialog system
    '../forgekit-rpg/tests/unit/test_npc_resource.gd': ['64.1'],
    '../forgekit-rpg/tests/unit/test_dialog_resource.gd': [
        '64.2', '64.3',
    ],
    '../forgekit-rpg/tests/unit/test_dialog_runner.gd': [
        '64.4', '64.5', '64.6',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_npcs_and_dialogs.gd': [
        '64.7', '64.8',
    ],
    '../forgekit-rpg/tests/unit/test_npc_tools_runtime.gd': [
        '64.1', '67.5',
    ],
    '../forgekit-rpg/tests/unit/test_dialog_tools_runtime.gd': [
        '64.4', '64.5', '64.6', '67.6',
    ],

    // Req 65 — Vendor
    '../forgekit-rpg/tests/unit/test_vendor_resource.gd': [
        '65.1', '65.2',
    ],
    '../forgekit-rpg/tests/unit/test_vendor.gd': [
        '65.3', '65.4', '65.5',
    ],
    '../forgekit-rpg/tests/unit/test_builtin_vendors.gd': ['65.6'],
    '../forgekit-rpg/tests/unit/test_vendor_tools_runtime.gd': [
        '65.3', '65.4', '65.5', '67.7',
    ],
    '../forgekit-rpg/tests/property/test_vendor_roundtrip.gd': ['68.5'],

    // Req 66 — GameEvents signals phase 5/6
    // (GameEvents schema + Core v0.7 bump — covered cross-repo by core's
    // test_game_events.gd and the module_scaffold test in forgekit-rpg)

    // Req 67 — MCP tool surface phase 6 (enemies/loot/spawner/chests/npc/dialog/vendor)
    '../forgekit-rpg/tests/unit/test_enemies_tools_runtime.gd': [
        '67.1', '67.8', '67.9',
    ],

    // Req 68 — Correctness properties phase 6 (44-48)
    // already mapped via loot + spawner + death_triggers_xp + vendor_roundtrip above

    // ---------------------------------------------------------------------
    // Phase 7 — Multi-project workspace support (Req 69–74)
    // ---------------------------------------------------------------------

    'mcp-server/test/projects/registry.test.ts': [
        '69.1', '69.2', '69.3', '69.4', '69.5', '69.6',
    ],
    'mcp-server/test/projects/workspace.test.ts': ['69.5'],
    'mcp-server/test/projects/workspace_channels.test.ts': [
        '70.1', '70.2', '70.5',
    ],
    'mcp-server/test/projects/persistence.test.ts': ['72.4'],
    'mcp-server/test/projects/auto_register.test.ts': [
        '73.1', '73.2', '73.3', '73.4',
    ],
    'mcp-server/test/projects/resolve_workspace.test.ts': [
        '71.1', '71.2', '71.3', '71.4', '71.5', '73.2',
    ],
    'mcp-server/test/projects/errors.test.ts': ['74.3'],
    'mcp-server/test/property_registry_determinism.test.ts': ['74.1'],
    'mcp-server/test/property_registry_errors.test.ts': ['74.3', '73.5'],
    'mcp-server/test/tools/project/list_workspaces.test.ts': ['72.1'],
    'mcp-server/test/tools/project/switch.test.ts': ['72.1', '72.3'],
    'mcp-server/test/tools/project/add.test.ts': ['72.1', '72.2', '72.3'],
    'mcp-server/test/tools/project/remove.test.ts': ['72.1', '72.3'],
    'mcp-server/test/tools/project/get_active.test.ts': ['72.1'],

    // Req 44 — rpg repo CI
    '../forgekit-rpg/.github/workflows/ci.yml': ['44.1'],
    '../forgekit-rpg/.github/workflows/release-module.yml': [
        '44.4', '44.5', '46.1', '46.2', '46.5',
    ],
};
