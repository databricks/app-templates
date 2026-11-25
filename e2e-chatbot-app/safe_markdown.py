"""Make links and images in model-written markdown non-clickable before st.markdown renders it.

The text is parsed with markdown-it and written back as markdown: links become their text, images their alt
text, URLs and email addresses inline code, and code keeps its content. Outside code, `[` and `]` are always
escaped, as is anything else that could start a link or change what is code when Streamlit renders the result.
"""

import logging
import re
import string
from bisect import bisect_left, bisect_right
from html.entities import html5
from itertools import accumulate

from markdown_it import MarkdownIt
from markdown_it.rules_inline import autolink, backtick, image, link

# markdown-it logs every block rule it tries at DEBUG level, which floods app logs that run at DEBUG.
logging.getLogger("markdown_it").setLevel(logging.INFO)

_PUNCTUATION = frozenset(string.punctuation)

# Backslash escapes, character references and single characters, as markdown reads text outside code.
_SOURCE = re.compile(
    r"\\[!-/:-@\[-`{-~\n]|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});|.", re.S
)
# Text that GFM turns into a link on its own. GFM also links an email domain that starts with a dot. An email
# address that directly follows another one after `.` or `+` is matched together with it, because the lookbehind
# keeps it from matching on its own.
_EMAIL_DOMAIN = r"(?:\.[\w-]+|[\w-]+\.[\w-]+)(?:\.[\w-]+)*"
_URL = re.compile(
    rf"(?P<url>(?:https?://|www\.)[^\s<>]*)|(?<![\w.+-])[\w.+-]+@{_EMAIL_DOMAIN}(?:[.+][\w.+-]*@{_EMAIL_DOMAIN})*",
    re.I,
)
# Streamlit's renderer also has math (`$`, `$$`) and directives (`:name{...}`, `:::`), which markdown-it doesn't
# parse. If one of those opened where markdown-it saw text, it could swallow the start of a code span or block
# and end inside it, leaving the rest of the code as markdown.
#
# `<...>` can be an autolink, a new `&...;` reference can spell out a URL, `:name{` starts directive attributes.
_INLINE_OPENER = re.compile(
    r"<(?=[^\s<>]+>)|&(?=#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)|:(?=[A-Za-z][\w-]*\{)"
)
_BLOCK_START = re.compile(
    r"[<>]|#{1,6}(?:[ \t]|$)|[-+*](?:[ \t]|$)|([-*_=])(?:[ \t]*\1)*[ \t]*$|[|: \t]*-[|:\- \t]*$|~~~|:::"
)
_ORDERED_ITEM = re.compile(r"([0-9]{1,9})[.)](?:[ \t]|$)")
_MATH_BLOCK_FENCE = re.compile(r"^[ \t]*\$\$", re.M)
_PIPE = re.compile(r"(?<!\\)(\\*)\|")


def _with_span(rule, token_type):
    # markdown-it tokens don't record where they came from; keep the source range of the ones rewritten here.
    def wrapped(state, silent):
        start, count = state.pos, len(state.tokens)
        if not rule(state, silent):
            return False
        token = None if silent else next((t for t in state.tokens[count:] if t.type == token_type), None)
        if token:
            end = state.pos
            # Same call the link rule made; markdown-it caches the scan, so the result matches.
            label_end = state.md.helpers.parseLinkLabel(state, start, True) if rule is link else -1
            token.meta["span"] = (start, end, label_end)
        return True

    return wrapped


_md = MarkdownIt("commonmark").enable("table")
for _name, _rule, _type in [
    ("backticks", backtick, "code_inline"),
    ("link", link, "link_open"),
    ("image", image, "image"),
    ("autolink", autolink, "link_open"),
]:
    _md.inline.ruler.at(_name, _with_span(_rule, _type))


def _close(tokens, i):
    depth = 0
    for j in range(i, len(tokens)):
        depth += tokens[j].nesting
        if depth == 0:
            return j
    return len(tokens) - 1


def _reference(ref):
    if ref[1] != "#":
        return html5.get(ref[1:])
    code = int(ref[3:-1], 16) if ref[2] in "xX" else int(ref[2:-1])
    return chr(code) if 0 < code < 0x110000 and not 0xD800 <= code < 0xE000 else "\ufffd"


# Units are (kind, value, source): "text" is a literal character, "raw" an escape or character reference
# (value decoded), "plain" a character that must show as itself, "code" the content of a code span.
def _source_units(text):
    units = []
    for match in _SOURCE.finditer(text):
        s = match.group()
        if s[0] == "\\" and len(s) == 2:
            units.append(("raw", s[1], s))
        elif s[0] == "&" and len(s) > 1 and (value := _reference(s)):
            units.append(("raw", value, s))
        else:
            units.extend(("text", c, c) for c in s)
    return units


def _alt_text(tokens):
    parts = []
    for token in tokens:
        if token.type == "image":
            parts.append(_alt_text(token.children or []))
        elif token.type in ("softbreak", "hardbreak"):
            parts.append(" ")
        else:
            parts.append(token.content)
    return "".join(parts)


def _inline_units(tokens, src, start, end):
    units, pos, i = [], start, 0
    while i < len(tokens):
        token = tokens[i]
        span = token.meta.get("span")
        if span:
            units += _source_units(src[pos : span[0]])
            pos = span[1]
            if token.type == "code_inline":
                units.append(("code", token.content, None))
            elif token.type == "image":
                units += [("plain", c, c) for c in _alt_text(token.children or [])]
            elif token.markup == "autolink":
                units.append(("code", src[span[0] + 1 : span[1] - 1], None))
            else:
                close = _close(tokens, i)
                units += _inline_units(tokens[i + 1 : close], src, span[0] + 1, span[2])
                i = close
        i += 1
    return units + _source_units(src[pos:end])


def _wrap_urls(units):
    out, run = [], []
    for unit in units + [("code", "", None)]:
        if unit[0] == "code":
            out += _wrap_run(run) + [unit]
            run = []
        else:
            run.append(unit)
    return out[:-1]


def _wrap_run(run):
    text = "".join(unit[1] for unit in run)
    starts = list(accumulate((len(unit[1]) for unit in run), initial=0))
    out, done = [], 0
    for match in _URL.finditer(text):
        end = match.end()
        if match["url"]:
            url = match["url"]
            while url[-1] in ".,:;!?'\"*_~)" and not (url[-1] == ")" and url.count("(") >= url.count(")")):
                url = url[:-1]
            end = match.start() + len(url)
        first = max(bisect_right(starts, match.start()) - 1, done)
        last = bisect_left(starts, end)
        if first < last:
            out += run[done:first] + [("code", "".join(unit[1] for unit in run[first:last]), None)]
            done = last
    return out + run[done:]


def _code_span(content):
    if not content:
        return ""
    runs = {len(run) for run in re.findall("`+", content)}
    ticks = "`" * next(n for n in range(1, len(runs) + 2) if n not in runs)
    if content[0] == "`" or content[-1] == "`" or (content[0] == content[-1] == " " and content.strip(" ")):
        content = f" {content} "
    return f"{ticks}{content}{ticks}"


def _serialize(units, cell=False, escape_math_blocks=False):
    escape_dollar = any(kind == "code" and "$" in value for kind, value, _ in units)
    out = []
    for i, (kind, value, source) in enumerate(units):
        if kind == "code":
            text = _code_span(value)
            if cell:
                text = _PIPE.sub(lambda m: "\\" * (2 * len(m[1]) + 1) + "|", text)
            if i and units[i - 1][0] == "code":
                text = " " + text
        elif kind == "raw":
            text = source
        elif kind == "plain":
            text = "\\" + value if value in _PUNCTUATION else value
        elif value == "\\":
            following = units[i + 1][:2] if i + 1 < len(units) else ("code", "")
            ordinary = following[0] in ("text", "plain") and following[1] not in _PUNCTUATION and following[1] != "\n"
            text = "\\" if ordinary else "\\\\"
        elif value in "[]`" or (cell and value == "|") or (escape_dollar and value == "$"):
            text = "\\" + value
        else:
            text = value
        out.append(text)

    joined = "".join(out)
    starts = list(accumulate(map(len, out), initial=0))
    for match in _INLINE_OPENER.finditer(joined):
        i = bisect_right(starts, match.start()) - 1
        if units[i][0] == "text":
            out[i] = "\\" + out[i]

    joined = "".join(out)
    starts = list(accumulate(map(len, out), initial=0))
    line_start = True
    for i, (kind, value, _) in enumerate(units):
        if line_start and kind in ("text", "plain") and value in " \t":
            out[i] = ""
            continue
        if line_start and kind == "text" and out[i] == value:
            end = joined.find("\n", starts[i])
            rest = joined[starts[i] : end if end >= 0 else len(joined)]
            if _BLOCK_START.match(rest) or (escape_math_blocks and rest.startswith("$$")):
                out[i] = "\\" + value
            elif item := _ORDERED_ITEM.match(rest):
                j = i + len(item[1])
                out[j] = "\\" + out[j]
        line_start = value == "\n"
    return "\n".join(line for line in "".join(out).split("\n") if line.strip())


def _inline(token, cell=False, escape_math_blocks=False):
    src = token.content
    units = _wrap_urls(_inline_units(token.children or [], src, 0, len(src)))
    return _serialize(units, cell, escape_math_blocks)


def _fence(content, info=""):
    ticks = "`" * max([3] + [len(run) + 1 for run in re.findall("`{3,}", content)])
    language = info.split()[0].replace("`", "") if info.strip() else ""
    if content and not content.endswith("\n"):
        content += "\n"
    return f"{ticks}{language}\n{content}{ticks}"


def _join(blocks, tight=False):
    text = ""
    for i, (kind, block) in enumerate(blocks):
        if i:
            text += "\n" if tight and "table_open" not in (kind, blocks[i - 1][0]) else "\n\n"
        text += block
    return text


def _list(token, inner, escape_math_blocks):
    tight = all(t.hidden for t in inner if t.type == "paragraph_open" and t.level == token.level + 2)
    items, i = [], 0
    while i < len(inner):
        close = _close(inner, i)
        item = inner[i]
        marker = f"{item.info}{item.markup}" if token.type == "ordered_list_open" else item.markup
        lines = _join(_blocks(inner[i + 1 : close], escape_math_blocks), tight).split("\n")
        pad = " " * (len(marker) + 1)
        first = f"{marker} {lines[0]}" if lines[0] else marker
        items.append("\n".join([first] + [pad + line if line else "" for line in lines[1:]]))
        i = close + 1
    return ("\n" if tight else "\n\n").join(items)


def _table(inner, escape_math_blocks):
    rows, aligns = [], []
    for token in inner:
        if token.type == "tr_open":
            rows.append([])
        elif token.type == "th_open":
            aligns.append(token.attrs.get("style", "").removeprefix("text-align:"))
        elif token.type == "inline":
            rows[-1].append(_inline(token, True, escape_math_blocks))
    delimiter = [{"left": ":--", "center": ":-:", "right": "--:"}.get(align, "---") for align in aligns]
    return "\n".join("| " + " | ".join(row) + " |" for row in [rows[0], delimiter] + rows[1:])


def _block(token, inner, escape_math_blocks):
    kind = token.type
    if kind == "paragraph_open":
        return _inline(inner[0], escape_math_blocks=escape_math_blocks)
    if kind == "heading_open":
        text = _inline(inner[0], escape_math_blocks=escape_math_blocks)
        if not text:
            return ""
        return f"{text}\n{token.markup * 3}" if token.markup in ("=", "-") else f"{token.markup} {text}"
    if kind == "blockquote_open":
        body = _join(_blocks(inner, escape_math_blocks))
        return "\n".join(f"> {line}" if line else ">" for line in body.split("\n")) if body else ""
    if kind in ("bullet_list_open", "ordered_list_open"):
        return _list(token, inner, escape_math_blocks)
    if kind == "table_open":
        return _table(inner, escape_math_blocks)
    if kind in ("fence", "code_block"):
        return _fence(token.content, token.info)
    if kind == "hr":
        return "***"
    if kind == "html_block":
        return _serialize([("plain", c, c) for c in token.content.strip("\n")])
    return ""


def _blocks(tokens, escape_math_blocks):
    blocks, i = [], 0
    while i < len(tokens):
        close = _close(tokens, i)
        text = _block(tokens[i], tokens[i + 1 : close], escape_math_blocks)
        if text:
            blocks.append((tokens[i].type, text))
        i = close + 1
    return blocks


def unlink_markdown(text):
    """Rewrite links as their text and images as their alt text, with URLs in inline code so they aren't autolinked."""
    tokens = _md.parse(text)
    escape_math_blocks = any(
        t.type in ("fence", "code_block") and _MATH_BLOCK_FENCE.search(t.content) for t in tokens
    )
    return _join(_blocks(tokens, escape_math_blocks))
