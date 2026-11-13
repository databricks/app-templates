from unittest.mock import Mock, create_autospec

import pytest
from databricks.sdk.service.iamv2 import DirectGroupMember, WorkspaceIamV2API

GROUP_ID = "1001"
PRINCIPAL_ID = 2002


def group_api(*member_ids: int) -> WorkspaceIamV2API:
    """A mock group API whose direct members are the given principals."""
    iam = create_autospec(WorkspaceIamV2API, instance=True)
    iam.list_direct_group_members_proxy.return_value = [
        DirectGroupMember(principal_id=member_id) for member_id in member_ids
    ]
    return iam


def test_a_failure_inside_the_block_puts_the_member_back(leave_group):
    iam = group_api()
    can_read = Mock(side_effect=[False, True])

    with (
        pytest.raises(RuntimeError),
        leave_group(iam, GROUP_ID, PRINCIPAL_ID, can_read),
    ):
        raise RuntimeError("a test failed outside the group")

    iam.create_direct_group_member_proxy.assert_called_once_with(
        GROUP_ID, DirectGroupMember(principal_id=PRINCIPAL_ID)
    )


def test_an_interrupt_during_the_removal_puts_the_member_back(leave_group):
    iam = group_api()
    iam.delete_direct_group_member_proxy.side_effect = KeyboardInterrupt

    with (
        pytest.raises(KeyboardInterrupt),
        leave_group(iam, GROUP_ID, PRINCIPAL_ID, Mock(return_value=True)),
    ):
        pass

    iam.create_direct_group_member_proxy.assert_called_once_with(
        GROUP_ID, DirectGroupMember(principal_id=PRINCIPAL_ID)
    )


def test_a_principal_still_in_the_group_is_not_added_again(leave_group):
    iam = group_api(PRINCIPAL_ID)
    iam.delete_direct_group_member_proxy.side_effect = TimeoutError

    with (
        pytest.raises(TimeoutError),
        leave_group(iam, GROUP_ID, PRINCIPAL_ID, Mock(return_value=True)),
    ):
        pass

    iam.create_direct_group_member_proxy.assert_not_called()
