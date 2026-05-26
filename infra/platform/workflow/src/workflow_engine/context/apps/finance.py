"""
FinanceAPI - Finance app API for workflows.

This module provides the Finance API for financial operations:
- Invoices: Create, send, record payments, void
- Accounts: Balance, transfers
- Transactions: Create, categorize
- Reports: P&L, balance sheet, cash flow
- Reconciliation: Bank statement import, matching
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from workflow_engine.context.apps.client import AppClient


logger = logging.getLogger(__name__)


@dataclass
class LineItem:
    """
    An invoice line item.

    Attributes:
        description: Item description
        amount: Item amount
        quantity: Quantity (default 1)
        unit_price: Price per unit
        tax_rate: Tax rate percentage
    """

    description: str
    amount: float
    quantity: int = 1
    unit_price: float | None = None
    tax_rate: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "description": self.description,
            "amount": self.amount,
            "quantity": self.quantity,
            "tax_rate": self.tax_rate,
        }
        if self.unit_price is not None:
            result["unit_price"] = self.unit_price
        return result


@dataclass
class Invoice:
    """A finance invoice."""

    id: str
    number: str = ""
    customer_id: str = ""
    amount: float = 0.0
    status: str = "draft"
    due_date: str | None = None
    line_items: List[Dict[str, Any]] = field(default_factory=list)
    notes: str = ""
    source_deal_id: str | None = None
    created_at: str | None = None
    sent_at: str | None = None
    paid_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Invoice":
        """Create Invoice from dictionary."""
        return cls(
            id=data["id"],
            number=data.get("number", ""),
            customer_id=data.get("customer_id", ""),
            amount=data.get("amount", 0.0),
            status=data.get("status", "draft"),
            due_date=data.get("due_date"),
            line_items=data.get("line_items", []),
            notes=data.get("notes", ""),
            source_deal_id=data.get("source_deal_id"),
            created_at=data.get("created_at"),
            sent_at=data.get("sent_at"),
            paid_at=data.get("paid_at"),
        )


@dataclass
class Payment:
    """A payment record."""

    id: str
    invoice_id: str
    amount: float
    method: str = ""
    reference: str = ""
    paid_at: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Payment":
        """Create Payment from dictionary."""
        return cls(
            id=data["id"],
            invoice_id=data.get("invoice_id", ""),
            amount=data.get("amount", 0.0),
            method=data.get("method", ""),
            reference=data.get("reference", ""),
            paid_at=data.get("paid_at"),
        )


@dataclass
class Transaction:
    """A financial transaction."""

    id: str
    account_id: str
    amount: float
    type: str = ""  # credit, debit
    category: str = ""
    description: str = ""
    reference: str = ""
    date: str | None = None
    reconciled: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Transaction":
        """Create Transaction from dictionary."""
        return cls(
            id=data["id"],
            account_id=data.get("account_id", ""),
            amount=data.get("amount", 0.0),
            type=data.get("type", ""),
            category=data.get("category", ""),
            description=data.get("description", ""),
            reference=data.get("reference", ""),
            date=data.get("date"),
            reconciled=data.get("reconciled", False),
        )


class FinanceAPI:
    """
    Finance API for workflow access.

    Provides domain-specific operations for financial functionality:
    - Invoices: Create, send, payment recording
    - Accounts: Balance checking, transfers
    - Transactions: Recording, categorization
    - Reports: Financial report generation

    Example:
        # Create an invoice
        invoice = ctx.apps.finance.create_invoice(
            customer_id=customer_id,
            amount=5000,
            due_days=30
        )

        # Send the invoice
        ctx.apps.finance.send_invoice(invoice["id"])

        # Record a payment
        ctx.apps.finance.record_payment(invoice["id"], 5000, method="wire")
    """

    def __init__(self, client: "AppClient") -> None:
        """
        Initialize the Finance API.

        Args:
            client: App client for gateway communication
        """
        self._client = client
        self._app = "finance"

    # =========================================================================
    # Invoices
    # =========================================================================

    def create_invoice(
        self,
        customer_id: str,
        amount: float | None = None,
        line_items: List[LineItem | Dict[str, Any]] | None = None,
        due_date: date | str | None = None,
        due_days: int | None = None,
        notes: str = "",
        source_deal_id: str | None = None,
    ) -> Dict[str, Any]:
        """
        Create a new invoice.

        Args:
            customer_id: Customer ID
            amount: Invoice amount (if not using line items)
            line_items: List of line items
            due_date: Due date
            due_days: Days until due (alternative to due_date)
            notes: Invoice notes
            source_deal_id: ID of originating deal

        Returns:
            Created invoice data

        Example:
            invoice = ctx.apps.finance.create_invoice(
                customer_id=company_id,
                line_items=[
                    {"description": "Consulting", "amount": 5000},
                    {"description": "Travel", "amount": 500}
                ],
                due_days=30
            )
        """
        logger.info(f"Creating invoice for customer: {customer_id}")

        payload: Dict[str, Any] = {"customer_id": customer_id}

        if amount is not None:
            payload["amount"] = amount

        if line_items:
            payload["line_items"] = [
                item.to_dict() if isinstance(item, LineItem) else item
                for item in line_items
            ]

        if due_date:
            if isinstance(due_date, date):
                payload["due_date"] = due_date.isoformat()
            else:
                payload["due_date"] = due_date
        elif due_days is not None:
            payload["due_days"] = due_days

        if notes:
            payload["notes"] = notes
        if source_deal_id:
            payload["source_deal_id"] = source_deal_id

        response = self._client.post(self._app, "/invoices", json=payload)
        return response.data

    def get_invoice(
        self,
        invoice_id: str,
    ) -> Dict[str, Any]:
        """
        Get an invoice by ID.

        Args:
            invoice_id: Invoice ID

        Returns:
            Invoice data
        """
        response = self._client.get(self._app, f"/invoices/{invoice_id}")
        return response.data

    def send_invoice(
        self,
        invoice_id: str,
        to_email: str | None = None,
    ) -> None:
        """
        Send an invoice to the customer.

        Args:
            invoice_id: Invoice ID
            to_email: Override recipient email
        """
        logger.info(f"Sending invoice: {invoice_id}")

        payload = {}
        if to_email:
            payload["to_email"] = to_email

        self._client.post(self._app, f"/invoices/{invoice_id}/send", json=payload or None)

    def record_payment(
        self,
        invoice_id: str,
        amount: float,
        method: str = "",
        reference: str = "",
        paid_at: datetime | str | None = None,
    ) -> Dict[str, Any]:
        """
        Record a payment against an invoice.

        Args:
            invoice_id: Invoice ID
            amount: Payment amount
            method: Payment method (wire, card, check, etc.)
            reference: Payment reference number
            paid_at: Payment timestamp

        Returns:
            Payment record
        """
        logger.info(f"Recording payment for invoice {invoice_id}: {amount}")

        payload: Dict[str, Any] = {"amount": amount}

        if method:
            payload["method"] = method
        if reference:
            payload["reference"] = reference
        if paid_at:
            if isinstance(paid_at, datetime):
                payload["paid_at"] = paid_at.isoformat()
            else:
                payload["paid_at"] = paid_at

        response = self._client.post(self._app, f"/invoices/{invoice_id}/payments", json=payload)
        return response.data

    def void_invoice(
        self,
        invoice_id: str,
        reason: str,
    ) -> None:
        """
        Void an invoice.

        Args:
            invoice_id: Invoice ID
            reason: Reason for voiding
        """
        logger.info(f"Voiding invoice {invoice_id}: {reason}")
        self._client.post(
            self._app,
            f"/invoices/{invoice_id}/void",
            json={"reason": reason},
        )

    # =========================================================================
    # Accounts
    # =========================================================================

    def get_account(
        self,
        account_id: str,
    ) -> Dict[str, Any]:
        """
        Get an account by ID.

        Args:
            account_id: Account ID

        Returns:
            Account data
        """
        response = self._client.get(self._app, f"/accounts/{account_id}")
        return response.data

    def get_account_balance(
        self,
        account_id: str,
        as_of: date | str | None = None,
    ) -> float:
        """
        Get the balance of an account.

        Args:
            account_id: Account ID
            as_of: Date to get balance as of

        Returns:
            Account balance
        """
        params = {}
        if as_of:
            if isinstance(as_of, date):
                params["as_of"] = as_of.isoformat()
            else:
                params["as_of"] = as_of

        response = self._client.get(
            self._app,
            f"/accounts/{account_id}/balance",
            params=params or None,
        )
        return response.data.get("balance", 0.0)

    def transfer_funds(
        self,
        from_account: str,
        to_account: str,
        amount: float,
        memo: str = "",
    ) -> Dict[str, Any]:
        """
        Transfer funds between accounts.

        Args:
            from_account: Source account ID
            to_account: Destination account ID
            amount: Amount to transfer
            memo: Transfer memo

        Returns:
            Transfer record
        """
        logger.info(f"Transferring {amount} from {from_account} to {to_account}")

        response = self._client.post(
            self._app,
            "/transfers",
            json={
                "from_account": from_account,
                "to_account": to_account,
                "amount": amount,
                "memo": memo,
            },
        )
        return response.data

    # =========================================================================
    # Transactions
    # =========================================================================

    def create_transaction(
        self,
        account_id: str,
        amount: float,
        type: str,
        category: str = "",
        description: str = "",
        reference: str = "",
        date: date | str | None = None,
    ) -> Dict[str, Any]:
        """
        Create a transaction.

        Args:
            account_id: Account ID
            amount: Transaction amount (positive)
            type: Transaction type (credit or debit)
            category: Category
            description: Description
            reference: External reference
            date: Transaction date

        Returns:
            Transaction data
        """
        logger.info(f"Creating {type} transaction: {amount}")

        payload: Dict[str, Any] = {
            "account_id": account_id,
            "amount": amount,
            "type": type,
        }

        if category:
            payload["category"] = category
        if description:
            payload["description"] = description
        if reference:
            payload["reference"] = reference
        if date:
            if isinstance(date, date):
                payload["date"] = date.isoformat()
            else:
                payload["date"] = date

        response = self._client.post(self._app, "/transactions", json=payload)
        return response.data

    def categorize_transaction(
        self,
        transaction_id: str,
        category: str,
    ) -> Dict[str, Any]:
        """
        Categorize a transaction.

        Args:
            transaction_id: Transaction ID
            category: Category name

        Returns:
            Updated transaction
        """
        response = self._client.patch(
            self._app,
            f"/transactions/{transaction_id}",
            json={"category": category},
        )
        return response.data

    # =========================================================================
    # Reports
    # =========================================================================

    def generate_profit_loss(
        self,
        start_date: date | str,
        end_date: date | str,
    ) -> Dict[str, Any]:
        """
        Generate a profit & loss report.

        Args:
            start_date: Report start date
            end_date: Report end date

        Returns:
            P&L report data
        """
        params = {
            "start_date": start_date.isoformat() if isinstance(start_date, date) else start_date,
            "end_date": end_date.isoformat() if isinstance(end_date, date) else end_date,
        }

        response = self._client.get(self._app, "/reports/profit-loss", params=params)
        return response.data

    def generate_balance_sheet(
        self,
        as_of_date: date | str,
    ) -> Dict[str, Any]:
        """
        Generate a balance sheet.

        Args:
            as_of_date: Report date

        Returns:
            Balance sheet data
        """
        params = {
            "as_of_date": as_of_date.isoformat() if isinstance(as_of_date, date) else as_of_date,
        }

        response = self._client.get(self._app, "/reports/balance-sheet", params=params)
        return response.data

    def generate_cash_flow(
        self,
        start_date: date | str,
        end_date: date | str,
    ) -> Dict[str, Any]:
        """
        Generate a cash flow report.

        Args:
            start_date: Report start date
            end_date: Report end date

        Returns:
            Cash flow report data
        """
        params = {
            "start_date": start_date.isoformat() if isinstance(start_date, date) else start_date,
            "end_date": end_date.isoformat() if isinstance(end_date, date) else end_date,
        }

        response = self._client.get(self._app, "/reports/cash-flow", params=params)
        return response.data

    # =========================================================================
    # Reconciliation
    # =========================================================================

    def import_bank_statement(
        self,
        csv: str,
        account_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Import transactions from a bank statement CSV.

        Args:
            csv: CSV content
            account_id: Account ID to import to

        Returns:
            List of imported transactions
        """
        logger.info(f"Importing bank statement to account: {account_id}")

        response = self._client.post(
            self._app,
            "/reconciliation/import",
            json={"csv": csv, "account_id": account_id},
        )
        return response.data.get("transactions", [])

    def reconcile_transactions(
        self,
        account_id: str,
        matches: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """
        Reconcile bank transactions with recorded transactions.

        Args:
            account_id: Account ID
            matches: List of {"bank_txn_id": ..., "recorded_txn_id": ...}

        Returns:
            Reconciliation result
        """
        logger.info(f"Reconciling {len(matches)} transactions for account: {account_id}")

        response = self._client.post(
            self._app,
            "/reconciliation/reconcile",
            json={"account_id": account_id, "matches": matches},
        )
        return response.data
