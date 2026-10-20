/** Generated from the pinned logical contract. Do not edit by hand. */
import type {Int64Text} from './types.js';
export const SCHEMA = {
  "account_bindings": {
    "source": "account_bindings",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "zenmoney_account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "bank_accounts": {
    "source": "bank_accounts",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "bank",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "identity_scope",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "profile_key",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "source_key",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "currency",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "scale",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "label",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "masked_number",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "supported",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "unsupported_reason",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "selection",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "zenmoney_account_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "import_start",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "last_complete_end",
        "type": "TEXT",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_bank_accounts_2",
        "columns": [
          "bank",
          "identity_scope",
          "profile_key",
          "source_key",
          "currency"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [],
    "checks": [
      "identity_scope IN ('bank','profile')",
      "scale BETWEEN 0 AND 12",
      "supported IN (0,1)",
      "selection IN ('unconfigured','enabled','ignored')",
      "settings_version>=0",
      "(identity_scope='bank' AND profile_key='') OR (identity_scope='profile' AND profile_key<>'')",
      "(selection='enabled' AND zenmoney_account_id IS NOT NULL AND import_start IS NOT NULL)\n    OR (selection<>'enabled' AND zenmoney_account_id IS NULL)"
    ],
    "triggers": []
  },
  "bank_aliases": {
    "source": "bank_aliases",
    "columns": [
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "external_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "identity_version",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "account_id",
      "external_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id",
          "account_id"
        ],
        "target": [
          "id",
          "account_id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "bank_exclusions": {
    "source": "bank_exclusions",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "reason",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "bank_processing": {
    "source": "bank_processing",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "state",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "reason",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "updated_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "state IN ('pending','prepared','uncertain','delivered','suppressed')"
    ],
    "triggers": [
      {
        "name": "processing_terminal_delete",
        "sql": "CREATE TRIGGER processing_terminal_delete BEFORE DELETE ON bank_processing\n WHEN OLD.state IN ('delivered','suppressed')\n BEGIN SELECT RAISE(ABORT,'Processed bank operation cannot be deleted'); END"
      },
      {
        "name": "processing_terminal_update",
        "sql": "CREATE TRIGGER processing_terminal_update BEFORE UPDATE OF state ON bank_processing\n WHEN (OLD.state='suppressed' AND NEW.state<>'suppressed')\n   OR (OLD.state='delivered' AND NEW.state NOT IN ('delivered','suppressed'))\n BEGIN SELECT RAISE(ABORT,'Processed bank operation cannot be reset'); END"
      }
    ]
  },
  "bank_transactions": {
    "source": "bank_transactions",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "external_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "identity_kind",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "identity_version",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "local_date",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "occurred_at",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "direction",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "amount",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "currency",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "description",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "beneficiary_account",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "beneficiary_name",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "raw_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "revision",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_bank_transactions_2",
        "columns": [
          "account_id",
          "external_id"
        ],
        "unique": true,
        "partial": null
      },
      {
        "key": "i1",
        "name": "sqlite_autoindex_bank_transactions_3",
        "columns": [
          "id",
          "account_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "identity_kind IN ('bank','fingerprint')",
      "direction IN ('expense','income')",
      "money_valid(amount)",
      "json_valid(raw_json)",
      "revision>=1"
    ],
    "triggers": [
      {
        "name": "bank_identity_immutable",
        "sql": "CREATE TRIGGER bank_identity_immutable BEFORE UPDATE ON bank_transactions\n WHEN NEW.id<>OLD.id OR NEW.account_id<>OLD.account_id OR NEW.external_id<>OLD.external_id\n BEGIN SELECT RAISE(ABORT,'Canonical bank identity is immutable'); END"
      }
    ]
  },
  "bank_versions": {
    "source": "bank_versions",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "revision",
        "type": "INTEGER",
        "required": true,
        "pk": 2
      },
      {
        "name": "data_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "raw_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "observed_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "parser_version",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id",
      "revision"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "revision>=1",
      "json_valid(data_json)",
      "json_valid(raw_json)"
    ],
    "triggers": [
      {
        "name": "bank_version_immutable",
        "sql": "CREATE TRIGGER bank_version_immutable BEFORE UPDATE ON bank_versions\n BEGIN SELECT RAISE(ABORT,'Bank revision history is append-only'); END"
      },
      {
        "name": "bank_version_preserved",
        "sql": "CREATE TRIGGER bank_version_preserved BEFORE DELETE ON bank_versions\n BEGIN SELECT RAISE(ABORT,'Bank revision history is append-only'); END"
      }
    ]
  },
  "capture_errors": {
    "source": "capture_errors",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "code",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "retryable",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "resolved",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "retryable IN (0,1)",
      "resolved IN (0,1)"
    ],
    "triggers": []
  },
  "capture_intervals": {
    "source": "capture_intervals",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "start_date",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "end_date",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "state",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "total_pages",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "total_records",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "interval_job_account",
        "columns": [
          "job_id",
          "account_id",
          "state"
        ],
        "unique": false,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "start_date<=end_date"
    ],
    "triggers": [
      {
        "name": "interval_identity",
        "sql": "CREATE TRIGGER interval_identity BEFORE UPDATE ON capture_intervals\n WHEN NEW.id<>OLD.id OR NEW.job_id<>OLD.job_id OR NEW.account_id<>OLD.account_id\n OR NEW.settings_version<>OLD.settings_version OR NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date\n OR (OLD.state='complete' AND (NEW.state<>'complete' OR NEW.total_pages IS NOT OLD.total_pages OR NEW.total_records IS NOT OLD.total_records))\n BEGIN SELECT RAISE(ABORT,'Capture interval identity and completion evidence are immutable'); END"
      },
      {
        "name": "interval_scope",
        "sql": "CREATE TRIGGER interval_scope BEFORE INSERT ON capture_intervals\n WHEN NOT EXISTS (SELECT 1 FROM job_accounts WHERE job_id=NEW.job_id AND account_id=NEW.account_id AND settings_version=NEW.settings_version)\n BEGIN SELECT RAISE(ABORT,'Interval must belong to a job account snapshot'); END"
      }
    ]
  },
  "capture_jobs": {
    "source": "capture_jobs",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "connection_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "request_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "request_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "end_date",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "capture_state",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "delivery_state",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "worker_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "lease_epoch",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "lease_expires_at",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "one_active_capture",
        "columns": [
          "connection_id"
        ],
        "unique": true,
        "partial": {
          "column": "capture_state",
          "values": [
            "planned",
            "collecting",
            "paused"
          ]
        }
      },
      {
        "key": "i1",
        "name": "sqlite_autoindex_capture_jobs_2",
        "columns": [
          "request_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "connections",
        "columns": [
          "connection_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(request_json)"
    ],
    "triggers": []
  },
  "capture_pages": {
    "source": "capture_pages",
    "columns": [
      {
        "name": "interval_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "page_number",
        "type": "INTEGER",
        "required": true,
        "pk": 2
      },
      {
        "name": "digest",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "records_count",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "payload_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "interval_id",
      "page_number"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "capture_intervals",
        "columns": [
          "interval_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "page_number>=1",
      "records_count>=0",
      "json_valid(payload_json)"
    ],
    "triggers": [
      {
        "name": "page_immutable",
        "sql": "CREATE TRIGGER page_immutable BEFORE UPDATE ON capture_pages\n BEGIN SELECT RAISE(ABORT,'Acknowledged pages are append-only'); END"
      },
      {
        "name": "page_preserved",
        "sql": "CREATE TRIGGER page_preserved BEFORE DELETE ON capture_pages\n BEGIN SELECT RAISE(ABORT,'Acknowledged pages are append-only'); END"
      }
    ]
  },
  "captured_records": {
    "source": "captured_records",
    "columns": [
      {
        "name": "interval_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "page_number",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "revision",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "interval_id",
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_versions",
        "columns": [
          "bank_id",
          "revision"
        ],
        "target": [
          "bank_id",
          "revision"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "capture_pages",
        "columns": [
          "interval_id",
          "page_number"
        ],
        "target": [
          "interval_id",
          "page_number"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": [
      {
        "name": "captured_record_immutable",
        "sql": "CREATE TRIGGER captured_record_immutable BEFORE UPDATE ON captured_records\n BEGIN SELECT RAISE(ABORT,'Captured revisions are append-only'); END"
      },
      {
        "name": "captured_record_preserved",
        "sql": "CREATE TRIGGER captured_record_preserved BEFORE DELETE ON captured_records\n BEGIN SELECT RAISE(ABORT,'Captured revisions are append-only'); END"
      },
      {
        "name": "captured_record_scope",
        "sql": "CREATE TRIGGER captured_record_scope BEFORE INSERT ON captured_records\n WHEN NOT EXISTS (SELECT 1 FROM capture_intervals i JOIN bank_transactions b ON b.id=NEW.bank_id\n                  WHERE i.id=NEW.interval_id AND i.account_id=b.account_id)\n BEGIN SELECT RAISE(ABORT,'Captured record must belong to interval account'); END"
      }
    ]
  },
  "category_choices": {
    "source": "category_choices",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "category_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "source",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "updated_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "category_evidence": {
    "source": "category_evidence",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "category_id",
        "type": "TEXT",
        "required": true,
        "pk": 3
      },
      {
        "name": "direction",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "eligible",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id",
      "zen_id",
      "category_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "eligible IN (0,1)"
    ],
    "triggers": []
  },
  "category_payments": {
    "source": "category_payments",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "category_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "reason",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "eligible",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "zen_ids_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "eligible IN (0,1)",
      "json_valid(zen_ids_json)"
    ],
    "triggers": []
  },
  "category_predictions": {
    "source": "category_predictions",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "bank_revision",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "category_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "source",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "reason",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "candidates_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "mirror_generation",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "updated_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_versions",
        "columns": [
          "bank_id",
          "bank_revision"
        ],
        "target": [
          "bank_id",
          "revision"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "source IN ('manual','rule','history','unknown')",
      "json_valid(candidates_json)"
    ],
    "triggers": []
  },
  "connection_accounts": {
    "source": "connection_accounts",
    "columns": [
      {
        "name": "connection_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      }
    ],
    "primary": [
      "connection_id",
      "account_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "connections",
        "columns": [
          "connection_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "connection_discovery": {
    "source": "connection_discovery",
    "columns": [
      {
        "name": "connection_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "present",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "supported",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "unsupported_reason",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "label",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "masked_number",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "connection_id",
      "account_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "connection_accounts",
        "columns": [
          "connection_id",
          "account_id"
        ],
        "target": [
          "connection_id",
          "account_id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "present IN (0,1)",
      "supported IN (0,1)"
    ],
    "triggers": []
  },
  "connection_labels": {
    "source": "connection_labels",
    "columns": [
      {
        "name": "connection_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "label",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "connection_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "connections",
        "columns": [
          "connection_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "length(trim(label)) BETWEEN 1 AND 120"
    ],
    "triggers": []
  },
  "connections": {
    "source": "connections",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "bank",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "profile_key",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "profile_identity",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "connector_version",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "timezone",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "capabilities_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "accounts_complete",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_connections_2",
        "columns": [
          "bank",
          "profile_key"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [],
    "checks": [
      "profile_identity IN ('bank','user_selected')",
      "json_valid(capabilities_json)",
      "accounts_complete IN (0,1)"
    ],
    "triggers": []
  },
  "coverage": {
    "source": "coverage",
    "columns": [
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "start_date",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "end_date",
        "type": "TEXT",
        "required": true,
        "pk": 3
      },
      {
        "name": "interval_id",
        "type": "TEXT",
        "required": true,
        "pk": 4
      }
    ],
    "primary": [
      "account_id",
      "start_date",
      "end_date",
      "interval_id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "coverage_account_dates",
        "columns": [
          "account_id",
          "start_date",
          "end_date"
        ],
        "unique": false,
        "partial": null
      },
      {
        "key": "i1",
        "name": "sqlite_autoindex_coverage_1",
        "columns": [
          "interval_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "capture_intervals",
        "columns": [
          "interval_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "start_date<=end_date"
    ],
    "triggers": []
  },
  "dataset_metadata": {
    "source": "service_meta",
    "columns": [
      {
        "name": "key",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "value",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "key"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [],
    "triggers": []
  },
  "deliveries": {
    "source": "deliveries",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "payload",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "state",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "ever_attempted",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "authorized_job_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "updated_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "needs_rebuild",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "zen_id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_deliveries_1",
        "columns": [
          "bank_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "capture_jobs",
        "columns": [
          "authorized_job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(payload)",
      "state IN ('prepared','attempting','uncertain','delivered','suppressed')",
      "ever_attempted IN (0,1)",
      "needs_rebuild IN (0,1)",
      "state<>'attempting' OR (ever_attempted=1 AND needs_rebuild=0)"
    ],
    "triggers": [
      {
        "name": "delivery_immutable",
        "sql": "CREATE TRIGGER delivery_immutable BEFORE UPDATE ON deliveries\n WHEN NEW.zen_id<>OLD.zen_id OR NEW.bank_id<>OLD.bank_id OR NEW.ever_attempted<OLD.ever_attempted\n   OR (OLD.ever_attempted=1 AND NEW.payload<>OLD.payload)\n   OR (OLD.state='suppressed' AND NEW.state<>'suppressed')\n   OR (OLD.state='delivered' AND NEW.state NOT IN ('delivered','suppressed'))\n BEGIN SELECT RAISE(ABORT,'Delivery identity or attempted payload is immutable'); END"
      },
      {
        "name": "delivery_preserved",
        "sql": "CREATE TRIGGER delivery_preserved BEFORE DELETE ON deliveries\n WHEN OLD.ever_attempted=1 OR OLD.state IN ('delivered','suppressed')\n BEGIN SELECT RAISE(ABORT,'Attempted delivery cannot be deleted'); END"
      }
    ]
  },
  "delivery_attempts": {
    "source": "delivery_attempts",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "outcome",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "payload",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "attempted_zen_id",
        "columns": [
          "zen_id"
        ],
        "unique": false,
        "partial": null
      },
      {
        "key": "i1",
        "name": "attempts_bank",
        "columns": [
          "bank_id"
        ],
        "unique": false,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(payload)"
    ],
    "triggers": [
      {
        "name": "attempt_immutable",
        "sql": "CREATE TRIGGER attempt_immutable BEFORE UPDATE ON delivery_attempts\n BEGIN SELECT RAISE(ABORT,'Delivery attempts are append-only'); END"
      },
      {
        "name": "attempt_preserved",
        "sql": "CREATE TRIGGER attempt_preserved BEFORE DELETE ON delivery_attempts\n BEGIN SELECT RAISE(ABORT,'Delivery attempts are append-only'); END"
      }
    ]
  },
  "delivery_authorizations": {
    "source": "delivery_authorizations",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "revision",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "interval_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "target_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "source_hash",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "authorized_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "captured_records",
        "columns": [
          "interval_id",
          "bank_id"
        ],
        "target": [
          "interval_id",
          "bank_id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_versions",
        "columns": [
          "bank_id",
          "revision"
        ],
        "target": [
          "bank_id",
          "revision"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": [
      {
        "name": "delivery_authorization_frozen",
        "sql": "CREATE TRIGGER delivery_authorization_frozen BEFORE UPDATE ON delivery_authorizations\n WHEN EXISTS(SELECT 1 FROM deliveries d WHERE d.bank_id=OLD.bank_id AND d.ever_attempted=1)\n BEGIN SELECT RAISE(ABORT,'Attempted delivery authorization is immutable'); END"
      },
      {
        "name": "delivery_authorization_preserved",
        "sql": "CREATE TRIGGER delivery_authorization_preserved BEFORE DELETE ON delivery_authorizations\n WHEN EXISTS(SELECT 1 FROM deliveries d WHERE d.bank_id=OLD.bank_id AND d.ever_attempted=1)\n BEGIN SELECT RAISE(ABORT,'Attempted delivery authorization cannot be deleted'); END"
      },
      {
        "name": "delivery_authorization_proof",
        "sql": "CREATE TRIGGER delivery_authorization_proof BEFORE INSERT ON delivery_authorizations\n WHEN NOT EXISTS (SELECT 1 FROM captured_records r JOIN capture_intervals i ON i.id=r.interval_id\n   JOIN bank_transactions b ON b.id=r.bank_id JOIN job_accounts a ON a.job_id=NEW.job_id AND a.account_id=b.account_id\n   WHERE r.interval_id=NEW.interval_id AND r.bank_id=NEW.bank_id AND r.revision=NEW.revision AND i.state='complete'\n     AND a.settings_version=NEW.settings_version AND a.target_id=NEW.target_id)\n BEGIN SELECT RAISE(ABORT,'Delivery needs completed capture and job authorization'); END"
      },
      {
        "name": "delivery_authorization_update_proof",
        "sql": "CREATE TRIGGER delivery_authorization_update_proof BEFORE UPDATE ON delivery_authorizations\n WHEN NOT EXISTS (SELECT 1 FROM captured_records r JOIN capture_intervals i ON i.id=r.interval_id\n   JOIN bank_transactions b ON b.id=r.bank_id JOIN job_accounts a ON a.job_id=NEW.job_id AND a.account_id=b.account_id\n   WHERE r.interval_id=NEW.interval_id AND r.bank_id=NEW.bank_id AND r.revision=NEW.revision AND i.state='complete'\n     AND a.settings_version=NEW.settings_version AND a.target_id=NEW.target_id)\n BEGIN SELECT RAISE(ABORT,'Delivery needs completed capture and job authorization'); END"
      }
    ]
  },
  "delivery_schedule": {
    "source": "delivery_schedule",
    "columns": [
      {
        "name": "id",
        "type": "INTEGER",
        "required": true,
        "pk": 1
      },
      {
        "name": "next_run_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "failures",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [
      "id=1",
      "failures>=0"
    ],
    "triggers": []
  },
  "job_accounts": {
    "source": "job_accounts",
    "columns": [
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "target_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "import_start",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "authorized_start",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "job_id",
      "account_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": [
      {
        "name": "job_account_snapshot",
        "sql": "CREATE TRIGGER job_account_snapshot BEFORE UPDATE ON job_accounts\n BEGIN SELECT RAISE(ABORT,'Job account settings snapshot is immutable'); END"
      }
    ]
  },
  "job_context": {
    "source": "job_context",
    "columns": [
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "connector_version",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "timezone",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "capabilities_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "job_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(capabilities_json)"
    ],
    "triggers": [
      {
        "name": "job_context_snapshot",
        "sql": "CREATE TRIGGER job_context_snapshot BEFORE UPDATE ON job_context\n BEGIN SELECT RAISE(ABORT,'Job connector context snapshot is immutable'); END"
      }
    ]
  },
  "job_requests": {
    "source": "job_requests",
    "columns": [
      {
        "name": "request_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "request_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "request_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(request_json)"
    ],
    "triggers": [
      {
        "name": "request_immutable",
        "sql": "CREATE TRIGGER request_immutable BEFORE UPDATE ON job_requests\n BEGIN SELECT RAISE(ABORT,'Command identity is immutable'); END"
      },
      {
        "name": "request_preserved",
        "sql": "CREATE TRIGGER request_preserved BEFORE DELETE ON job_requests\n BEGIN SELECT RAISE(ABORT,'Command identity is permanent'); END"
      }
    ]
  },
  "legacy_imports": {
    "source": "legacy_imports",
    "columns": [
      {
        "name": "digest",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "imported_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "source_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "manifest_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "report_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "digest"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [
      "json_valid(manifest_json)",
      "json_valid(report_json)"
    ],
    "triggers": []
  },
  "legacy_objects": {
    "source": "legacy_objects",
    "columns": [
      {
        "name": "source_digest",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "type",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "name",
        "type": "TEXT",
        "required": true,
        "pk": 3
      },
      {
        "name": "table_name",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "sql",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "columns_json",
        "type": "TEXT",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "source_digest",
      "type",
      "name"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "legacy_imports",
        "columns": [
          "source_digest"
        ],
        "target": [
          "digest"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "legacy_rows": {
    "source": "legacy_rows",
    "columns": [
      {
        "name": "source_digest",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "table_name",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "ordinal",
        "type": "INTEGER",
        "required": true,
        "pk": 3
      },
      {
        "name": "values_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "source_digest",
      "table_name",
      "ordinal"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "legacy_imports",
        "columns": [
          "source_digest"
        ],
        "target": [
          "digest"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(values_json)"
    ],
    "triggers": []
  },
  "link_bank_members": {
    "source": "link_bank_members",
    "columns": [
      {
        "name": "group_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      }
    ],
    "primary": [
      "group_id",
      "bank_id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_link_bank_members_1",
        "columns": [
          "bank_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "link_groups",
        "columns": [
          "group_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "link_groups": {
    "source": "link_groups",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "kind IN ('single','split','settlement')"
    ],
    "triggers": []
  },
  "link_zen_members": {
    "source": "link_zen_members",
    "columns": [
      {
        "name": "group_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      }
    ],
    "primary": [
      "group_id",
      "zen_id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "sqlite_autoindex_link_zen_members_1",
        "columns": [
          "zen_id"
        ],
        "unique": true,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "link_groups",
        "columns": [
          "group_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "processing_receipts": {
    "source": "processing_receipts",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id",
      "zen_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": [
      {
        "name": "receipt_immutable",
        "sql": "CREATE TRIGGER receipt_immutable BEFORE UPDATE ON processing_receipts\n BEGIN SELECT RAISE(ABORT,'Confirmed processing history is append-only'); END"
      },
      {
        "name": "receipt_preserved",
        "sql": "CREATE TRIGGER receipt_preserved BEFORE DELETE ON processing_receipts\n BEGIN SELECT RAISE(ABORT,'Confirmed processing history is append-only'); END"
      }
    ]
  },
  "processing_targets": {
    "source": "processing_targets",
    "columns": [
      {
        "name": "bank_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "target_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank_id",
      "zen_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "bank_transactions",
        "columns": [
          "bank_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "length(target_id)>0"
    ],
    "triggers": [
      {
        "name": "processing_target_immutable",
        "sql": "CREATE TRIGGER processing_target_immutable BEFORE UPDATE ON processing_targets\n BEGIN SELECT RAISE(ABORT,'Matched account ownership is immutable'); END"
      },
      {
        "name": "processing_target_preserved",
        "sql": "CREATE TRIGGER processing_target_preserved BEFORE DELETE ON processing_targets\n BEGIN SELECT RAISE(ABORT,'Matched account ownership is permanent'); END"
      }
    ]
  },
  "recipient_rules": {
    "source": "recipient_rules",
    "columns": [
      {
        "name": "bank",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "name",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "direction",
        "type": "TEXT",
        "required": true,
        "pk": 3
      },
      {
        "name": "category_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "updated_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "bank",
      "name",
      "direction"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [],
    "triggers": []
  },
  "reimport_ranges": {
    "source": "reimport_ranges",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "settings_version",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "source_job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "remaining_json",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "capture_jobs",
        "columns": [
          "source_job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(remaining_json)"
    ],
    "triggers": []
  },
  "source_capture_leases": {
    "source": "account_capture_locks",
    "columns": [
      {
        "name": "account_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "job_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "account_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "capture_jobs",
        "columns": [
          "job_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      },
      {
        "table": "bank_accounts",
        "columns": [
          "account_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "source_schema_migrations": {
    "source": "schema_migrations",
    "columns": [
      {
        "name": "version",
        "type": "INTEGER",
        "required": true,
        "pk": 1
      },
      {
        "name": "applied_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "backup_path",
        "type": "TEXT",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "version"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [],
    "triggers": []
  },
  "zen_deletions": {
    "source": "zen_deletions",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "run_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "entity_id",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "data",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "zen_sync_runs",
        "columns": [
          "run_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(data)"
    ],
    "triggers": []
  },
  "zen_entities": {
    "source": "zen_entities",
    "columns": [
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "data",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "changed",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "deleted",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "run_id",
        "type": "TEXT",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "kind",
      "id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "zen_sync_runs",
        "columns": [
          "run_id"
        ],
        "target": [
          "id"
        ],
        "onDelete": "NO ACTION"
      }
    ],
    "checks": [
      "json_valid(data)",
      "deleted IN (0,1)"
    ],
    "triggers": []
  },
  "zen_exclusions": {
    "source": "zen_exclusions",
    "columns": [
      {
        "name": "zen_id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "created_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "zen_id"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [],
    "triggers": []
  },
  "zen_mirror_state": {
    "source": "zen_mirror_state",
    "columns": [
      {
        "name": "id",
        "type": "INTEGER",
        "required": true,
        "pk": 1
      },
      {
        "name": "source_hash",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "cursor",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "generation",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "needs_full",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "ready",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "refreshed_at",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "error_code",
        "type": "TEXT",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [
      "id=1",
      "cursor>=0",
      "generation>=0",
      "needs_full IN (0,1)",
      "ready IN (0,1)"
    ],
    "triggers": []
  },
  "zen_movements": {
    "source": "zen_movements",
    "columns": [
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "date",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "income_account",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "outcome_account",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "income_instrument",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "outcome_instrument",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "income",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "outcome",
        "type": "TEXT",
        "required": false,
        "pk": 0
      },
      {
        "name": "viewed",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "hold",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      }
    ],
    "primary": [
      "kind",
      "id"
    ],
    "indexes": [
      {
        "key": "i0",
        "name": "movement_accounts",
        "columns": [
          "income_account",
          "outcome_account",
          "date"
        ],
        "unique": false,
        "partial": null
      }
    ],
    "foreignKeys": [
      {
        "table": "zen_entities",
        "columns": [
          "kind",
          "id"
        ],
        "target": [
          "kind",
          "id"
        ],
        "onDelete": "CASCADE"
      }
    ],
    "checks": [
      "kind IN ('transaction','reminder','reminderMarker')"
    ],
    "triggers": []
  },
  "zen_sync_runs": {
    "source": "zen_sync_runs",
    "columns": [
      {
        "name": "id",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "received_at",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      },
      {
        "name": "requested_cursor",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "response_cursor",
        "type": "INTEGER",
        "required": false,
        "pk": 0
      },
      {
        "name": "origin",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "payload",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "id"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [
      "json_valid(payload)"
    ],
    "triggers": []
  },
  "zen_tags": {
    "source": "zen_tags",
    "columns": [
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "entity_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "tag_id",
        "type": "TEXT",
        "required": true,
        "pk": 3
      },
      {
        "name": "position",
        "type": "INTEGER",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "kind",
      "entity_id",
      "tag_id"
    ],
    "indexes": [],
    "foreignKeys": [
      {
        "table": "zen_entities",
        "columns": [
          "kind",
          "entity_id"
        ],
        "target": [
          "kind",
          "id"
        ],
        "onDelete": "CASCADE"
      }
    ],
    "checks": [],
    "triggers": []
  },
  "zen_tombstones": {
    "source": "zen_tombstones",
    "columns": [
      {
        "name": "kind",
        "type": "TEXT",
        "required": true,
        "pk": 1
      },
      {
        "name": "entity_id",
        "type": "TEXT",
        "required": true,
        "pk": 2
      },
      {
        "name": "reason",
        "type": "TEXT",
        "required": true,
        "pk": 0
      },
      {
        "name": "data",
        "type": "TEXT",
        "required": true,
        "pk": 0
      }
    ],
    "primary": [
      "kind",
      "entity_id"
    ],
    "indexes": [],
    "foreignKeys": [],
    "checks": [
      "json_valid(data)"
    ],
    "triggers": [
      {
        "name": "tombstone_identity",
        "sql": "CREATE TRIGGER tombstone_identity BEFORE UPDATE ON zen_tombstones\n WHEN NEW.kind<>OLD.kind OR NEW.entity_id<>OLD.entity_id\n BEGIN SELECT RAISE(ABORT,'Remote deletion identity is immutable'); END"
      },
      {
        "name": "tombstone_preserved",
        "sql": "CREATE TRIGGER tombstone_preserved BEFORE DELETE ON zen_tombstones\n BEGIN SELECT RAISE(ABORT,'Remote deletion history is permanent'); END"
      }
    ]
  }
} as const;
export type TableName = keyof typeof SCHEMA;
export interface RowByTable {
"account_bindings": {
  readonly id: string;
  readonly account_id: string;
  readonly zenmoney_account_id: string;
  readonly settings_version: Int64Text | null;
  readonly origin: string;
  readonly created_at: Int64Text;
};
"bank_accounts": {
  readonly id: string;
  readonly bank: string;
  readonly identity_scope: string;
  readonly profile_key: string;
  readonly source_key: string;
  readonly currency: string;
  readonly scale: Int64Text;
  readonly label: string;
  readonly masked_number: string;
  readonly supported: Int64Text;
  readonly unsupported_reason: string | null;
  readonly selection: string;
  readonly zenmoney_account_id: string | null;
  readonly import_start: string | null;
  readonly settings_version: Int64Text;
  readonly last_complete_end: string | null;
};
"bank_aliases": {
  readonly account_id: string;
  readonly external_id: string;
  readonly identity_version: string;
  readonly bank_id: string;
};
"bank_exclusions": {
  readonly bank_id: string;
  readonly reason: string;
  readonly created_at: Int64Text;
};
"bank_processing": {
  readonly bank_id: string;
  readonly state: string;
  readonly reason: string;
  readonly updated_at: Int64Text;
};
"bank_transactions": {
  readonly id: string;
  readonly account_id: string;
  readonly external_id: string;
  readonly identity_kind: string;
  readonly identity_version: string;
  readonly local_date: string;
  readonly occurred_at: string | null;
  readonly direction: string;
  readonly amount: string;
  readonly currency: string;
  readonly description: string;
  readonly beneficiary_account: string | null;
  readonly beneficiary_name: string | null;
  readonly raw_json: string;
  readonly revision: Int64Text;
};
"bank_versions": {
  readonly bank_id: string;
  readonly revision: Int64Text;
  readonly data_json: string;
  readonly raw_json: string;
  readonly observed_at: Int64Text;
  readonly parser_version: string;
};
"capture_errors": {
  readonly id: string;
  readonly job_id: string;
  readonly account_id: string | null;
  readonly code: string;
  readonly retryable: Int64Text;
  readonly resolved: Int64Text;
  readonly created_at: Int64Text;
};
"capture_intervals": {
  readonly id: string;
  readonly job_id: string;
  readonly account_id: string;
  readonly settings_version: Int64Text;
  readonly start_date: string;
  readonly end_date: string;
  readonly state: string;
  readonly total_pages: Int64Text | null;
  readonly total_records: Int64Text | null;
};
"capture_jobs": {
  readonly id: string;
  readonly connection_id: string;
  readonly request_id: string;
  readonly request_json: string;
  readonly end_date: string;
  readonly capture_state: string;
  readonly delivery_state: string;
  readonly worker_id: string | null;
  readonly lease_epoch: Int64Text;
  readonly lease_expires_at: Int64Text | null;
  readonly created_at: Int64Text;
};
"capture_pages": {
  readonly interval_id: string;
  readonly page_number: Int64Text;
  readonly digest: string;
  readonly records_count: Int64Text;
  readonly payload_json: string;
};
"captured_records": {
  readonly interval_id: string;
  readonly page_number: Int64Text;
  readonly bank_id: string;
  readonly revision: Int64Text;
};
"category_choices": {
  readonly bank_id: string;
  readonly category_id: string | null;
  readonly source: string;
  readonly updated_at: Int64Text;
};
"category_evidence": {
  readonly bank_id: string;
  readonly zen_id: string;
  readonly category_id: string;
  readonly direction: string;
  readonly origin: string;
  readonly eligible: Int64Text;
};
"category_payments": {
  readonly bank_id: string;
  readonly category_id: string | null;
  readonly reason: string;
  readonly eligible: Int64Text;
  readonly zen_ids_json: string;
};
"category_predictions": {
  readonly bank_id: string;
  readonly bank_revision: Int64Text;
  readonly category_id: string | null;
  readonly source: string;
  readonly reason: string;
  readonly candidates_json: string;
  readonly mirror_generation: Int64Text;
  readonly updated_at: Int64Text;
};
"connection_accounts": {
  readonly connection_id: string;
  readonly account_id: string;
};
"connection_discovery": {
  readonly connection_id: string;
  readonly account_id: string;
  readonly present: Int64Text;
  readonly supported: Int64Text;
  readonly unsupported_reason: string | null;
  readonly label: string;
  readonly masked_number: string;
};
"connection_labels": {
  readonly connection_id: string;
  readonly label: string;
};
"connections": {
  readonly id: string;
  readonly bank: string;
  readonly profile_key: string;
  readonly profile_identity: string;
  readonly connector_version: string;
  readonly timezone: string | null;
  readonly capabilities_json: string;
  readonly accounts_complete: Int64Text;
};
"coverage": {
  readonly account_id: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly interval_id: string;
};
"dataset_metadata": {
  readonly key: string;
  readonly value: string;
};
"deliveries": {
  readonly bank_id: string;
  readonly zen_id: string;
  readonly payload: string;
  readonly state: string;
  readonly ever_attempted: Int64Text;
  readonly origin: string;
  readonly authorized_job_id: string | null;
  readonly updated_at: Int64Text;
  readonly needs_rebuild: Int64Text;
};
"delivery_attempts": {
  readonly id: string;
  readonly bank_id: string;
  readonly zen_id: string;
  readonly at: Int64Text;
  readonly outcome: string;
  readonly payload: string;
};
"delivery_authorizations": {
  readonly bank_id: string;
  readonly revision: Int64Text;
  readonly job_id: string;
  readonly interval_id: string;
  readonly settings_version: Int64Text;
  readonly target_id: string;
  readonly source_hash: string | null;
  readonly authorized_at: Int64Text;
};
"delivery_schedule": {
  readonly id: Int64Text;
  readonly next_run_at: Int64Text;
  readonly failures: Int64Text;
};
"job_accounts": {
  readonly job_id: string;
  readonly account_id: string;
  readonly settings_version: Int64Text;
  readonly target_id: string;
  readonly import_start: string;
  readonly authorized_start: string;
};
"job_context": {
  readonly job_id: string;
  readonly connector_version: string;
  readonly timezone: string;
  readonly capabilities_json: string;
};
"job_requests": {
  readonly request_id: string;
  readonly job_id: string;
  readonly request_json: string;
};
"legacy_imports": {
  readonly digest: string;
  readonly imported_at: Int64Text;
  readonly source_version: Int64Text;
  readonly manifest_json: string;
  readonly report_json: string;
};
"legacy_objects": {
  readonly source_digest: string;
  readonly type: string;
  readonly name: string;
  readonly table_name: string;
  readonly sql: string | null;
  readonly columns_json: string | null;
};
"legacy_rows": {
  readonly source_digest: string;
  readonly table_name: string;
  readonly ordinal: Int64Text;
  readonly values_json: string;
};
"link_bank_members": {
  readonly group_id: string;
  readonly bank_id: string;
};
"link_groups": {
  readonly id: string;
  readonly kind: string;
  readonly account_id: string;
  readonly created_at: Int64Text;
  readonly origin: string;
};
"link_zen_members": {
  readonly group_id: string;
  readonly zen_id: string;
};
"processing_receipts": {
  readonly bank_id: string;
  readonly zen_id: string;
  readonly origin: string;
  readonly at: Int64Text;
};
"processing_targets": {
  readonly bank_id: string;
  readonly zen_id: string;
  readonly target_id: string;
  readonly origin: string;
  readonly at: Int64Text;
};
"recipient_rules": {
  readonly bank: string;
  readonly name: string;
  readonly direction: string;
  readonly category_id: string;
  readonly updated_at: Int64Text;
};
"reimport_ranges": {
  readonly id: string;
  readonly account_id: string;
  readonly settings_version: Int64Text;
  readonly source_job_id: string;
  readonly remaining_json: string;
};
"source_capture_leases": {
  readonly account_id: string;
  readonly job_id: string;
};
"source_schema_migrations": {
  readonly version: Int64Text;
  readonly applied_at: Int64Text;
  readonly backup_path: string | null;
};
"zen_deletions": {
  readonly id: string;
  readonly run_id: string | null;
  readonly kind: string;
  readonly entity_id: string;
  readonly data: string;
};
"zen_entities": {
  readonly kind: string;
  readonly id: string;
  readonly data: string;
  readonly changed: Int64Text | null;
  readonly deleted: Int64Text;
  readonly run_id: string | null;
};
"zen_exclusions": {
  readonly zen_id: string;
  readonly created_at: Int64Text;
};
"zen_mirror_state": {
  readonly id: Int64Text;
  readonly source_hash: string | null;
  readonly cursor: Int64Text;
  readonly generation: Int64Text;
  readonly needs_full: Int64Text;
  readonly ready: Int64Text;
  readonly refreshed_at: Int64Text | null;
  readonly error_code: string | null;
};
"zen_movements": {
  readonly kind: string;
  readonly id: string;
  readonly date: string | null;
  readonly income_account: string | null;
  readonly outcome_account: string | null;
  readonly income_instrument: string | null;
  readonly outcome_instrument: string | null;
  readonly income: string | null;
  readonly outcome: string | null;
  readonly viewed: Int64Text | null;
  readonly hold: Int64Text | null;
};
"zen_sync_runs": {
  readonly id: string;
  readonly received_at: Int64Text;
  readonly requested_cursor: Int64Text | null;
  readonly response_cursor: Int64Text | null;
  readonly origin: string;
  readonly payload: string;
};
"zen_tags": {
  readonly kind: string;
  readonly entity_id: string;
  readonly tag_id: string;
  readonly position: Int64Text;
};
"zen_tombstones": {
  readonly kind: string;
  readonly entity_id: string;
  readonly reason: string;
  readonly data: string;
};
}
