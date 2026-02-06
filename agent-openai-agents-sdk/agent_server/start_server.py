import uvicorn


def main():
    uvicorn.run("app:app")
    # agent_server.run(app_import_string="app:app")


if __name__ == "__main__":
    main()
