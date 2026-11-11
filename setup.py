from pathlib import Path

from setuptools import find_packages, setup

readme_path = Path(__file__).parent / "README.md"
long_description = readme_path.read_text(encoding="utf-8") if readme_path.exists() else ""

setup(
    name="tutor-arm-diagram",
    version="0.1.0",
    description="Tutor plugin and Open edX XBlock for Architecture Runtime Model (ARM) diagramming and grading",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Open edX Community",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "arm_diagram_xblock": [
            "static/css/*.css",
            "static/js/*.js",
            "static/html/*.html",
        ],
    },
    install_requires=[
        "tutor>=15.0.0",
        "xblock>=1.6.0",
        "pydantic>=2.0.0",
    ],
    entry_points={
        "tutor.plugin.v1": [
            "arm_diagram = tutor_arm_diagram.plugin",
        ],
        "xblock.v1": [
            "arm_diagram = arm_diagram_xblock.xblock:ARMDiagramXBlock",
            "arm_diagram_xblock = arm_diagram_xblock.xblock:ARMDiagramXBlock",
        ],
    },
    license="GPLv3",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Education",
        "License :: OSI Approved :: GNU General Public License v3 (GPLv3)",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
