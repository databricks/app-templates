DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks sync . "/Users/$DATABRICKS_USERNAME/vercel-chatbot"
databricks apps deploy lysgaard-vercel-chat-bot --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/vercel-chatbot
