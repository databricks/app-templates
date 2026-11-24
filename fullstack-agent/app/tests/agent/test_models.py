import pytest

from agent import models
from agent.models import allowed_models, model_named


@pytest.fixture
def models_file(monkeypatch, tmp_path):
    """Point the models at a file of the test's own, read afresh."""
    path = tmp_path / "models.toml"
    monkeypatch.setattr(models, "MODELS_FILE", path)
    allowed_models.cache_clear()
    yield path
    allowed_models.cache_clear()


def test_sonnet_is_the_default_and_the_others_read_images():
    default, *others = allowed_models()

    assert (default.id, default.images, default.reasoning) == (
        "sonnet_llm",
        False,
        "between_tools",
    )
    assert [(model.id, model.images) for model in others] == [("opus_llm", True)]
    assert model_named(None) == default


def test_a_model_that_isnt_allowed_is_refused():
    with pytest.raises(ValueError, match="'other_llm' is not allowed.*sonnet_llm"):
        model_named("other_llm")


def test_a_model_with_an_unknown_reasoning_style_fails_on_load(models_file):
    models_file.write_text(
        '[[models]]\nid = "x"\nname = "X"\nimages = false\n'
        'reasoning = "budget"\ncontext_window = 1\n'
    )

    with pytest.raises(ValueError, match="'x' has reasoning 'budget'.*adaptive"):
        allowed_models()
