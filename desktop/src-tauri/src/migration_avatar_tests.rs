use super::*;

#[test]
fn retired_starters_have_no_compiled_in_avatars() {
    for legacy in LEGACY_BUILTIN_AVATARS {
        assert!(
            crate::managed_agents::built_in_persona_avatar_url(legacy.persona_id).is_none(),
            "{} must not have a compiled-in avatar after retirement",
            legacy.persona_id
        );
        assert!(
            crate::managed_agents::built_in_persona_definition(legacy.persona_id, "now").is_none(),
            "{} must not seed a definition after retirement",
            legacy.persona_id
        );
    }
}

#[test]
fn refresh_builtin_agent_avatars_is_noop_without_compiled_in_avatars() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("managed-agents.json");
    let old_fizz = "data:image/png;base64,old-fizz";
    let records = serde_json::json!([
        {
            "id": "builtin:fizz",
            "display_name": "Fizz",
            "avatar_url": old_fizz,
            "system_prompt": "prompt",
            "is_builtin": true,
            "is_active": true,
            "shared": false,
            "name_pool": [],
            "env_vars": {},
            "respond_to_allowlist": [],
            "created_at": "before",
            "updated_at": "before"
        }
    ]);
    let original = serde_json::to_vec_pretty(&records).unwrap();
    std::fs::write(&path, &original).unwrap();

    // LEGACY hashes won't match our synthetic data URL; even if they did,
    // there is no replacement avatar in BUILT_IN_PERSONAS.
    refresh_builtin_agent_avatars_in_file(&path, LEGACY_BUILTIN_AVATARS, "after");

    assert_eq!(
        std::fs::read(&path).unwrap(),
        original,
        "avatar refresh must leave records untouched when starters are retired"
    );
}
