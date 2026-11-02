import os
from dataclasses import dataclass
from functools import cache


@dataclass(frozen=True)
class Settings:
    """Workspace values from the environment; project prefixes schemas."""

    catalog: str
    project: str
    warehouse_id: str
    version: str
    environment: str

    @property
    def data_schema(self) -> str:
        return f"{self.project}_data"

    @property
    def reference_schema(self) -> str:
        return f"{self.project}_reference"

    @property
    def ops_schema(self) -> str:
        return f"{self.project}_ops"

    def model_service(self, model_id: str) -> str:
        """The full name of the model service `model_id` in the ops schema."""
        return f"{self.catalog}.{self.ops_schema}.{model_id}"

    @property
    def trace_metadata(self) -> dict[str, str]:
        """The trace metadata that names the deployed commit and environment."""
        return {"app.version": self.version, "app.environment": self.environment}


@cache
def settings() -> Settings:
    """Read environment variables once. Missing vars raise KeyError."""
    return Settings(
        catalog=os.environ["APP_CATALOG"],
        project=os.environ["APP_PROJECT"],
        warehouse_id=os.environ["APP_WAREHOUSE_ID"],
        version=os.getenv("APP_VERSION", "local"),
        environment=os.getenv("APP_ENVIRONMENT", "local"),
    )
