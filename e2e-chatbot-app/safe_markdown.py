"""Make links and images in model-written markdown non-clickable before st.markdown renders it."""
import re

# Fenced code blocks (unclosed ones run to the end, e.g. while streaming) and inline code spans.
# Markdown doesn't create links inside these, so they are left untouched.
_CODE = re.compile(
    r"^ {0,3}(?P<fence>`{3,}|~{3,}).*?(?:^ {0,3}(?P=fence)[ \t]*$|\Z)"
    r"|(?P<ticks>`+).+?(?<!`)(?P=ticks)(?!`)",
    re.M | re.S,
)

_LINK_TEXT = r"(?:[^\[\]\n]|\[[^\[\]\n]*\])*"
_DESTINATION = r"<[^<>\n]*>|(?:[^\s()]|\([^\s()]*\))*"
_TITLE = r"(?:\s+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^()\n]*\)))?"
_BARE_URL = r"(?:https?://|www\.)[^\s<>`]*[^\s<>`.,:;!?'\")\]*_~]"

_MARKUP = re.compile(
    rf"(?P<image>!)?\[(?P<text>{_LINK_TEXT})\]\(\s*(?P<dest>{_DESTINATION}){_TITLE}\s*\)"
    r"|<(?P<autolink>[a-zA-Z][a-zA-Z0-9+.\-]{1,31}:[^\s<>]*)>"
    rf"|(?P<url>{_BARE_URL})",
    re.I,
)
_URL = re.compile(_BARE_URL, re.I)
# `[label]: url` definitions would turn `[label]` elsewhere into a link.
_DEFINITION = re.compile(r"^( {0,3})\[(?=[^\]\n]+\]:)", re.M)


def _code(url):
    return f"`{url.strip('<>').replace('`', '')}`"


def _replace(match):
    if match["url"] or match["autolink"]:
        return _code(match["url"] or match["autolink"])
    text = _URL.sub(lambda m: _code(m.group()), match["text"]).strip()
    if not match["dest"].strip("<>"):
        return text
    url = _code(match["dest"])
    return f"{text} ({url})" if text else url


def _unlink(text):
    text = _MARKUP.sub(_replace, text)
    text = _DEFINITION.sub(r"\1\\[", text)
    # Catches links whose text holds a code span, which the split around code leaves behind.
    return text.replace("](", "\\](")


def unlink_markdown(text):
    """Rewrite links as `text (url)` and images as `alt (url)`, with URLs in inline code so they aren't autolinked."""
    parts, pos = [], 0
    for match in _CODE.finditer(text):
        parts.append(_unlink(text[pos:match.start()]))
        parts.append(match.group())
        pos = match.end()
    parts.append(_unlink(text[pos:]))
    return "".join(parts)
