from runtime import main


def test_the_local_server_listens_only_on_the_loopback_address(monkeypatch):
    runs = []
    monkeypatch.setattr(
        main.uvicorn, "run", lambda *args, **kwargs: runs.append(kwargs)
    )

    main.main()

    assert runs[0]["host"] == "127.0.0.1"
