from fastapi.testclient import TestClient

from backend.server import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestSettingsEndpoint:
    def test_get_settings_returns_defaults(self):
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "llm_base_url" in data
        assert "llm_api_key" in data
        assert "decomposer_model" in data
        assert "default_model" in data

    def test_put_settings_updates_values(self):
        response = client.put("/api/settings", json={"default_model": "qwen3.5:35b"})
        assert response.status_code == 200
        data = response.json()
        assert data["default_model"] == "qwen3.5:35b"

    def test_put_settings_partial_update(self):
        response = client.put("/api/settings", json={"decomposer_model": "qwen3.5:35b"})
        assert response.status_code == 200
        data = response.json()
        assert data["decomposer_model"] == "qwen3.5:35b"


class TestConversationEndpoints:
    def test_create_conversation(self):
        response = client.post("/api/conversations?title=Test+Conv")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == "Test Conv"

    def test_list_conversations(self):
        client.post("/api/conversations?title=List+Test")
        response = client.get("/api/conversations")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_nonexistent_conversation(self):
        response = client.get("/api/conversations/nonexistent_id")
        assert response.status_code == 404

    def test_delete_conversation(self):
        create_resp = client.post("/api/conversations?title=Delete+Me")
        conv_id = create_resp.json()["id"]
        response = client.delete(f"/api/conversations/{conv_id}")
        assert response.status_code == 200
        assert response.json()["ok"] is True


class TestStaticEndpoints:
    def test_index_returns_html(self):
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_sync_endpoint(self):
        response = client.post("/api/sync")
        assert response.status_code == 200
        data = response.json()
        assert "total" in data


class TestRunEndpointValidation:
    def test_run_empty_query_rejected(self):
        response = client.post("/run?query=%20%20&conv_id=test")
        assert response.status_code == 400

    def test_run_excessively_long_query_rejected(self):
        long_query = "x" * 20000
        response = client.post(f"/run?query={long_query}&conv_id=test")
        assert response.status_code == 400

    def test_run_creates_task(self):
        response = client.post("/run?query=Hello+World")
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert "conv_id" in data


class TestCancelEndpoint:
    def test_cancel_unknown_task(self):
        response = client.post("/cancel/nonexistent")
        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_cancel_created_task(self):
        run_resp = client.post("/run?query=Hello+World")
        task_id = run_resp.json()["task_id"]
        response = client.post(f"/cancel/{task_id}")
        assert response.status_code == 200
        assert response.json()["ok"] is True


class TestTraceEndpoint:
    def test_trace_unknown_subtask(self):
        response = client.get("/api/trace/unknown_task/unknown_subtask")
        assert response.status_code == 404
