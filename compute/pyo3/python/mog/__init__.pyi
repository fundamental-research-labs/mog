from typing import Any, Optional
from mog.workbook import Workbook
from mog.worksheet import Worksheet
from mog.errors import AddressError, ComputeError, MogError, NativeApiError, UnsupportedApiError

def create_workbook(principal: Optional[list[str]] = None) -> Workbook: ...
def open_workbook(path: str, principal: Optional[list[str]] = None) -> Workbook: ...
