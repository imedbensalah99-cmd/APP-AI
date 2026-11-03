"""Offline-only contract checks for candidate OMDA Task OS D1/SQLite schema.
No cloud account, remote D1, credentials, or other projects are accessed.
"""
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

SCHEMA = (Path(__file__).with_name("schema.sql")).read_text()
NOW = "2026-11-03T10:00:00Z"
AFTER = "2026-11-06T10:00:00Z"
OWNER_A = "synthetic-owner-a"
OWNER_B = "synthetic-owner-b"
DIGEST = "a" * 64
def new_connection(path=":memory:"):
    c = sqlite3.connect(path, timeout=3)
    c.execute("PRAGMA foreign_keys = ON")
    c.executescript(SCHEMA)
    return c

def task(c, tid, owner, idem="idempotency-123", state="PLANNED"):
    c.execute("""INSERT INTO omda_task_tasks(
        task_id,owner_scope,idempotency_key,request_digest_sha256,original_command,intent_json,
        status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?)""",
    (tid, owner, idem, DIGEST, "Create a synthetic workbook", '["spreadsheet.generate"]', state, NOW, NOW))

def approval(c, aid, tid, owner, state="APPROVED", expire=AFTER):
    c.execute("""INSERT INTO omda_task_approvals(
        approval_id,task_id,owner_scope,operation,target,payload_digest_sha256,
        payload_version,status,issued_at,expires_at,audit_event_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
    (aid, tid, owner, "email.send", "test@example.invalid", DIGEST, 1,
     state, NOW, expire, "audit-test"))

def consume(c, aid, owner, digest=DIGEST, target="test@example.invalid", now="2026-11-03T11:00:00Z"):
    cur=c.execute("""UPDATE omda_task_approvals
        SET status='CONSUMED', consumed_at=?
        WHERE approval_id=? AND owner_scope=? AND status='APPROVED'
          AND target=? AND payload_digest_sha256=? AND expires_at>?
        RETURNING approval_id""",
        (now, aid, owner, target, digest, now))
    row=cur.fetchone()
    c.commit()
    return row

class TaskSchemaTests(unittest.TestCase):
    def setUp(self):
        self.c=new_connection()
        task(self.c,"task-a",OWNER_A)
        self.c.commit()
    def tearDown(self):
        self.c.close()

    def test_isolated_schema_idempotent_no_other_project_tables(self):
        self.c.executescript(SCHEMA)
        tables={row[0] for row in self.c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertGreaterEqual(len(tables),9)
        self.assertTrue(all(n.startswith("omda_task_") for n in tables))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM omda_task_tasks").fetchone()[0],1)

    def test_deduplicate_same_owner_same_idempotency(self):
        with self.assertRaises(sqlite3.IntegrityError):
            task(self.c,"task-a-new",OWNER_A)
        task(self.c,"task-b",OWNER_B)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM omda_task_tasks").fetchone()[0],2)

    def test_block_cross_owner_step_and_invalid_task_status(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("""INSERT INTO omda_task_steps(
               step_id, task_id, owner_scope, kind, input_json,
               status,created_at,updated_at
               ) VALUES(?,?,?,?,?,?,?,?)""",
               ("step-b","task-a", OWNER_B,"spreadsheet.generate","{}","PLANNED",NOW,NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            task(self.c,"invalid",OWNER_A,"new-key-123","LIVE_VERIFIED")
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM omda_task_steps").fetchone()[0],0)

    def test_deny_paid_budget_and_wrong_project(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("UPDATE omda_task_tasks SET budget_microunits=1 WHERE task_id='task-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("UPDATE omda_task_tasks SET project_scope='omda2' WHERE task_id='task-a'")

    def test_one_time_approval_and_tamper_and_expiry(self):
        approval(self.c,"approval-1","task-a",OWNER_A)
        self.c.commit()
        self.assertIsNone(consume(self.c,"approval-1",OWNER_B))
        self.assertIsNone(consume(self.c,"approval-1",OWNER_A,digest="0"*64))
        self.assertIsNone(consume(self.c,"approval-1",OWNER_A,target="attacker@example.invalid"))
        self.assertIsNone(consume(self.c,"approval-1",OWNER_A,now="2026-11-07T10:00:00Z"))
        self.assertEqual(consume(self.c,"approval-1",OWNER_A),("approval-1",))
        self.assertIsNone(consume(self.c,"approval-1",OWNER_A))
        self.assertEqual(self.c.execute("SELECT status FROM omda_task_approvals").fetchone()[0],"CONSUMED")

    def test_immutable_approval_id_and_effect_idempotency(self):
        approval(self.c,"approval-1","task-a",OWNER_A)
        self.c.execute("""INSERT INTO omda_task_external_actions(
          action_id,task_id,owner_scope,approval_id,action_kind,target,
          payload_digest_sha256,idempotency_key,state,recorded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
          ("act1","task-a",OWNER_A,"approval-1","email.send",
           "test@example.invalid",DIGEST,"external-action-123","PREPARED",NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("""INSERT INTO omda_task_external_actions(
              action_id,task_id,owner_scope,approval_id,action_kind,target,
              payload_digest_sha256,idempotency_key,state,recorded_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
              ("act2","task-a",OWNER_A,"approval-1","email.send",
               "test@example.invalid",DIGEST,"external-action-2","PREPARED",NOW))

    def test_artifact_scope_signature_and_size_validation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("""INSERT INTO omda_task_artifacts(
              artifact_id, task_id, owner_scope, filename, mime, size_bytes,
              sha256, object_ref, version, validation_state, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
              ("a1","task-a",OWNER_B,"data.xlsx","application/zip",100,DIGEST,"private:object",1,"PASS",NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("""INSERT INTO omda_task_artifacts(
              artifact_id, task_id, owner_scope, filename, mime, size_bytes,
              sha256, object_ref, version, validation_state, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
              ("a2","task-a",OWNER_A,"data.xlsx","application/zip",0,DIGEST,"private:object",1,"PASS",NOW))

    def test_parallel_approval_claim_one_winner(self):
        with TemporaryDirectory() as directory:
            db=Path(directory)/"isolated.sqlite"
            c=new_connection(str(db))
            task(c,"parallel-task",OWNER_A)
            approval(c,"parallel-approval","parallel-task",OWNER_A)
            c.commit()
            c.close()
            gate=Barrier(2)
            def worker(_):
                q=sqlite3.connect(str(db),timeout=5)
                q.execute("PRAGMA foreign_keys=ON")
                gate.wait()
                result=consume(q,"parallel-approval",OWNER_A)
                q.close()
                return result
            with ThreadPoolExecutor(max_workers=2) as ex:
                winners=list(ex.map(worker,range(2)))
            self.assertEqual(sum(bool(x) for x in winners),1)

if __name__=="__main__":
    unittest.main(verbosity=2)
