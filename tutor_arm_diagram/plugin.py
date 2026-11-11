"""Tutor plugin for ARM Diagram (Architecture Runtime Model) XBlock."""

from tutor import hooks

# Configuration defaults
hooks.Filters.CONFIG_DEFAULTS.add_items(
    [
        ("ARM_DIAGRAM_ENABLE", True),
        ("ARM_DIAGRAM_PIP_REQUIREMENT", "tutor-arm-diagram"),
    ]
)

# Injects the XBlock pip dependency into Open edX LMS & CMS Docker image build
hooks.Filters.ENV_PATCHES.add_items(
    [
        (
            "openedx-dockerfile-post-python-requirements",
            """
# Install ARM Diagram XBlock
RUN pip install {{ ARM_DIAGRAM_PIP_REQUIREMENT }}
""",
        ),
        (
            "openedx-lms-common-settings",
            """
# ARM Diagram XBlock Feature Flags
FEATURES["ENABLE_ARM_DIAGRAM_XBLOCK"] = True
""",
        ),
        (
            "openedx-cms-common-settings",
            """
# ARM Diagram XBlock Feature Flags
FEATURES["ENABLE_ARM_DIAGRAM_XBLOCK"] = True
""",
        ),
    ]
)
