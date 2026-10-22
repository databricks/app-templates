"""Wire translation between the Responses API and the OpenAI Agents SDK.

``inbound``: Responses request -> agent-SDK run input. ``outbound``: agent-SDK stream events ->
Responses wire events. SDK-specific — a different harness would replace this layer.
"""
