"""OpenAI Agents SDK boundary.

``inbound``: pull the session id from the request (its ``input`` is passed straight to the SDK).
``outbound``: serialize the SDK's stream events to JSON dicts. SDK-specific — a different SDK would
replace this layer.
"""
