"""Unit tests for Tutor plugin registration and hooks."""

from tutor import hooks
import tutor_arm_diagram.plugin as plugin


def test_tutor_plugin_config_defaults():
    """Verify tutor plugin config defaults."""
    assert plugin is not None
    # Check that hook filters contain arm diagram configuration
    config_items = dict(hooks.Filters.CONFIG_DEFAULTS.iterate())
    assert "ARM_DIAGRAM_ENABLE" in config_items
    assert config_items["ARM_DIAGRAM_ENABLE"] is True
    assert "ARM_DIAGRAM_PIP_REQUIREMENT" in config_items


def test_tutor_plugin_env_patches():
    """Verify tutor plugin environment patches."""
    env_patches = list(hooks.Filters.ENV_PATCHES.iterate())
    patch_names = [p[0] for p in env_patches]
    assert "openedx-dockerfile-post-python-requirements" in patch_names
    assert "openedx-lms-common-settings" in patch_names
    assert "openedx-cms-common-settings" in patch_names
