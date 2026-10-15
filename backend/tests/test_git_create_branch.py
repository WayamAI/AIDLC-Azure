"""create_branch must validate both names and must not hide a failed base-branch checkout."""
import git
import pytest

from app.services import git_service, workspace_service


@pytest.fixture
def workspace(tmp_path):
    clone = tmp_path / "clone"
    clone.mkdir()
    repo = git.Repo.init(clone)
    (clone / "README.md").write_text("hi\n", encoding="utf-8")
    repo.index.add(["README.md"])
    actor = git.Actor("t", "t@example.com")
    repo.index.commit("init", author=actor, committer=actor)
    base = repo.active_branch.name
    repo.close()

    workspace_service._WORKSPACES["ws_branch"] = {
        "workspace_id": "ws_branch",
        "org_id": "org_a",
        "clone_dir": str(clone),
        "pat": None,
    }
    yield clone, base
    workspace_service._WORKSPACES.pop("ws_branch", None)


async def test_missing_base_branch_raises_instead_of_branching_from_wherever_head_is(workspace):
    clone, _ = workspace

    with pytest.raises(ValueError, match="base branch 'no-such-base'"):
        await git_service.create_branch("org_a", "ws_branch", "feature/x", from_branch="no-such-base")

    assert "feature/x" not in [h.name for h in git.Repo(clone).heads]


async def test_create_branch_from_existing_base_succeeds(workspace):
    clone, base = workspace

    result = await git_service.create_branch("org_a", "ws_branch", "feature/ok", from_branch=base)

    assert result == {"branch": "feature/ok", "from": base}
    assert git.Repo(clone).active_branch.name == "feature/ok"


@pytest.mark.parametrize("bad_name", ["--orphan", "a..b", "feature/", "", "x.lock"])
async def test_invalid_new_branch_name_is_rejected(workspace, bad_name):
    _, base = workspace
    with pytest.raises(ValueError):
        await git_service.create_branch("org_a", "ws_branch", bad_name, from_branch=base)


@pytest.mark.parametrize("bad_base", ["--detach", "main..x", "../etc"])
async def test_invalid_base_branch_name_is_rejected(workspace, bad_base):
    with pytest.raises(ValueError):
        await git_service.create_branch("org_a", "ws_branch", "feature/y", from_branch=bad_base)


async def test_existing_branch_name_is_a_value_error(workspace):
    _, base = workspace
    await git_service.create_branch("org_a", "ws_branch", "feature/dup", from_branch=base)

    with pytest.raises(ValueError, match="already exists"):
        await git_service.create_branch("org_a", "ws_branch", "feature/dup", from_branch=base)
