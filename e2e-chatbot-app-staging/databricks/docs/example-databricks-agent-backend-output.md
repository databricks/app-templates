Example output from cURLing https://e2-demo-west.cloud.databricks.com/ml/endpoints/agents_users-sid_murching-test_chat_app_agent/

data: {"type":"response.output_text.delta","item_id":"e091dcfba731484daa2f4a700ee7d7bb","delta":"this text corresponds to source1","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}


data: {"item_id":"e091dcfba731484daa2f4a700ee7d7bb","annotation":{"url":"source1.com","title":"source1","type":"url_citation"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045","annotation_index":0,"type":"response.output_text.annotation.added"}

data: {"type":"response.output_text.delta","item_id":"e091dcfba731484daa2f4a700ee7d7bb","delta":"\nthis text corresponds to source2","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"item_id":"e091dcfba731484daa2f4a700ee7d7bb","annotation":{"url":"source2.com","title":"source2","type":"url_citation"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045","annotation_index":0,"type":"response.output_text.annotation.added"}

data: {"type":"response.output_item.done","item":{"id":"e091dcfba731484daa2f4a700ee7d7bb","content":[{"text":"this text corresponds to source1\nthis text corresponds to source2","type":"output_text","annotations":[{"url":"source1.com","title":"source1","type":"url_citation"},{"url":"source2.com","title":"source2","type":"url_citation"}]}],"role":"assistant","type":"message"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":"I","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" can help you calculate","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" 7 *","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" 8 using","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" Python. Let me","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" execute","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" this","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" simple","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" multiplication for","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":" you.","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","delta":"","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_item.done","item":{"id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","content":[{"text":"I can help you calculate 7 * 8 using Python. Let me execute this simple multiplication for you.","type":"output_text"}],"role":"assistant","type":"message"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_item.done","item":{"name":"system__ai__python_exec","id":"msg_bdrk_01Qb61wQ8K5Q9GPFbCftEHr9","type":"function_call","call_id":"toolu_bdrk_01AZkN6yVXQcnT2Uz3EeJAeo","arguments":"{\"code\": \"# Calculate 7 * 8\\nresult = 7 * 8\\nprint(result)\"}"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_item.done","item":{"type":"function_call_output","call_id":"toolu_bdrk_01AZkN6yVXQcnT2Uz3EeJAeo","output":"56\n"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","delta":"The result of","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","delta":" 7 *","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","delta":" 8 is","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","delta":" 56.","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_text.delta","item_id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","delta":"","id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}

data: {"type":"response.output_item.done","item":{"id":"msg_bdrk_01NQD7YzZ4zr4j6wk9KMxZBM","content":[{"text":"The result of 7 * 8 is 56.","type":"output_text"}],"role":"assistant","type":"message"},"id":"8bbae358-4dd1-436c-ac6c-aa1211408045","databricks_output":{"app_version_id":"models:/users.sid_murching.test_chat_app_agent/3","databricks_request_id":"8bbae358-4dd1-436c-ac6c-aa1211408045"}}

data: [DONE]