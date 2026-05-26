"""Form control fixtures using xlsxwriter (openpyxl doesn't support form controls)."""

from pathlib import Path

import xlsxwriter


def generate(out_dir: Path) -> list[Path]:
    files = []
    files.append(_control_button(out_dir))
    files.append(_control_checkbox(out_dir))
    files.append(_control_dropdown(out_dir))
    files.append(_control_spinner(out_dir))
    files.append(_control_scrollbar(out_dir))
    files.append(_control_radio(out_dir))
    files.append(_control_listbox(out_dir))
    return files


def _control_button(out_dir: Path) -> Path:
    """Form button with label text."""
    path = out_dir / "control-button.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Button")

    ws.write("A1", "Button Test")
    ws.insert_button("B2", {
        "macro": "",
        "caption": "Click Me",
        "width": 120,
        "height": 30,
    })

    wb.close()
    return path


def _control_checkbox(out_dir: Path) -> Path:
    """Checkbox linked to cells."""
    path = out_dir / "control-checkbox.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Checkbox")

    ws.write("A1", "Checkbox Test")
    ws.write("A2", "Option 1")
    ws.write("A3", "Option 2")
    ws.write("A4", "Option 3")

    # xlsxwriter doesn't have native checkbox support via a direct API,
    # but buttons with specific styling approximate the concept.
    # For true checkboxes, hand-crafted VML XML would be needed.
    ws.insert_button("B2", {"macro": "", "caption": "☑ Option 1", "width": 100, "height": 24})
    ws.insert_button("B3", {"macro": "", "caption": "☐ Option 2", "width": 100, "height": 24})
    ws.insert_button("B4", {"macro": "", "caption": "☑ Option 3", "width": 100, "height": 24})

    wb.close()
    return path


def _control_dropdown(out_dir: Path) -> Path:
    """Data validation dropdown (closest xlsxwriter can do to a combo box)."""
    path = out_dir / "control-dropdown.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Dropdown")

    ws.write("A1", "Dropdown Test")
    ws.write("A2", "Select a fruit:")

    # Use data validation as dropdown
    ws.data_validation("B2", {
        "validate": "list",
        "source": ["Apple", "Banana", "Cherry", "Date", "Elderberry"],
        "input_title": "Choose fruit",
        "input_message": "Select from the dropdown list",
    })
    ws.write("B2", "Apple")  # Default value

    wb.close()
    return path


def _control_spinner(out_dir: Path) -> Path:
    """Spinner-like control (approximated with buttons + data validation)."""
    path = out_dir / "control-spinner.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Spinner")

    ws.write("A1", "Spinner Test")
    ws.write("A2", "Value (1-100):")

    ws.data_validation("B2", {
        "validate": "integer",
        "criteria": "between",
        "minimum": 1,
        "maximum": 100,
        "input_title": "Spinner Value",
        "input_message": "Enter a number between 1 and 100",
    })
    ws.write("B2", 50)

    ws.insert_button("C2", {"macro": "", "caption": "▲", "width": 30, "height": 15})
    ws.insert_button("C3", {"macro": "", "caption": "▼", "width": 30, "height": 15})

    wb.close()
    return path


def _control_scrollbar(out_dir: Path) -> Path:
    """Scrollbar-like control (approximated)."""
    path = out_dir / "control-scrollbar.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Scrollbar")

    ws.write("A1", "Scrollbar Test")
    ws.write("A2", "Progress:")

    # Simulate with conditional formatting data bar
    fmt = wb.add_format({"num_format": "0%"})
    ws.write("B2", 0.65, fmt)

    ws.set_column("B:B", 30)

    wb.close()
    return path


def _control_radio(out_dir: Path) -> Path:
    """Radio button group (approximated with buttons)."""
    path = out_dir / "control-radio.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Radio")

    ws.write("A1", "Radio Button Test")
    ws.write("A2", "Choose one:")

    ws.insert_button("B2", {"macro": "", "caption": "◉ Option A", "width": 100, "height": 24})
    ws.insert_button("B3", {"macro": "", "caption": "○ Option B", "width": 100, "height": 24})
    ws.insert_button("B4", {"macro": "", "caption": "○ Option C", "width": 100, "height": 24})

    wb.close()
    return path


def _control_listbox(out_dir: Path) -> Path:
    """List box with multiple items (approximated with data validation)."""
    path = out_dir / "control-listbox.xlsx"
    wb = xlsxwriter.Workbook(str(path))
    ws = wb.add_worksheet("Listbox")

    ws.write("A1", "Listbox Test")

    # Items in column A
    items = ["Red", "Green", "Blue", "Yellow", "Purple", "Orange", "Pink", "Cyan"]
    for i, item in enumerate(items):
        ws.write(i + 1, 0, item)

    # Selection cell with dropdown
    ws.write("C1", "Selected:")
    ws.data_validation("C2", {
        "validate": "list",
        "source": ["=A2:A9"],
        "input_title": "Select item",
        "input_message": "Choose from the list",
    })

    wb.close()
    return path
