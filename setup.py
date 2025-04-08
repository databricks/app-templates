import io

from setuptools import setup

setup(name="databricks-apps-templates",
      version="1.0",
      python_requires=">=3.7",
      extras_require={"dev": ["yapf", "pycodestyle", "autoflake", "isort"]},
      author="Theo Fernandez",
      author_email="theo.fernandez@databricks.com",
      description="Databricks Apps templates for Python",
      long_description=io.open("README.md", encoding="utf-8").read(),
      long_description_content_type='text/markdown',
      url="https://docs.databricks.com/en/dev-tools/databricks-apps/index.html",
      keywords="databricks apps templates",
      classifiers=[
          "Development Status :: 4 - Beta", "Intended Audience :: Developers",
          "Programming Language :: Python :: 3.7", "Programming Language :: Python :: 3.8",
          "Programming Language :: Python :: 3.9", "Programming Language :: Python :: 3.10",
          "Programming Language :: Python :: 3.11", "Programming Language :: Python :: 3.12",
          "Operating System :: OS Independent"
      ])
