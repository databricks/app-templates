import uvicorn


def main():
    uvicorn.run(
        "custom_server.app:combined_app",  # import path to your `app`
        host="0.0.0.0",
        port=8000,
        reload=True,  # optional
    )