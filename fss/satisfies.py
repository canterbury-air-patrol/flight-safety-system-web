"""
Traceability decorator linking automated tests to CAP master-plan TC-WEB-*
test case IDs (TEST-06). The master-plan audit merges the report this
generates with the Tier-2/Tier-3 collectors to show which tier the evidence
for each TC-WEB-* ID came from.

Tag only what a test substantially verifies - a test that merely exercises
a code path in passing isn't evidence for the hazard mitigation the ID names.
"""


def satisfies(*tc_ids):
    """Mark a Django TestCase method as evidence for one or more TC-WEB-* IDs."""

    def decorator(test_func):
        test_func.satisfies_tc_ids = tc_ids
        return test_func

    return decorator
