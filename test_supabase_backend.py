# test_supabase_backend.py
import unittest
from unittest.mock import MagicMock, patch
import config
from supabase_client import SupabaseService
from app import app

class TestBagBuddySupabaseBackend(unittest.TestCase):

    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_01_configuration_validation(self):
        """Test configuration validation warning when keys are missing vs present."""
        with patch.object(config, 'SUPABASE_URL', ''), patch.object(config, 'SUPABASE_KEY', ''):
            is_valid = config.validate_supabase_config()
            self.assertFalse(is_valid)

        with patch.object(config, 'SUPABASE_URL', 'https://test.supabase.co'), patch.object(config, 'SUPABASE_KEY', 'valid-key'):
            is_valid = config.validate_supabase_config()
            self.assertTrue(is_valid)

    def test_02_supabase_service_signup_and_profile_creation(self):
        """Verify Supabase Auth sign_up and profile record synchronization."""
        service = SupabaseService()
        service.url = 'https://mockproject.supabase.co'
        service.key = 'mock-key-123'
        mock_client = MagicMock()
        service._client = mock_client

        mock_user = MagicMock()
        mock_user.id = 'usr-uuid-1111-2222'
        mock_user.user_metadata = {'name': 'John Doe'}
        mock_res = MagicMock()
        mock_res.user = mock_user
        mock_res.session = MagicMock()
        mock_res.session.access_token = 'jwt-token-john'
        mock_client.auth.sign_up.return_value = mock_res

        success, uid, name, email, token, err = service.sign_up('John Doe', 'john@example.com', 'password123')
        self.assertTrue(success)
        self.assertEqual(uid, 'usr-uuid-1111-2222')
        self.assertEqual(name, 'John Doe')
        self.assertEqual(email, 'john@example.com')
        self.assertEqual(token, 'jwt-token-john')
        self.assertIsNone(err)

    def test_03_supabase_service_login_flow(self):
        """Verify Supabase Auth sign_in, profile lookup, and user data retrieval."""
        service = SupabaseService()
        service.url = 'https://mockproject.supabase.co'
        service.key = 'mock-key-123'
        mock_client = MagicMock()
        service._client = mock_client

        mock_user = MagicMock()
        mock_user.id = 'usr-uuid-1111-2222'
        mock_user.email = 'john@example.com'
        mock_user.user_metadata = {'name': 'John Doe'}
        mock_res = MagicMock()
        mock_res.user = mock_user
        mock_res.session = MagicMock()
        mock_res.session.access_token = 'jwt-token-john'
        mock_client.auth.sign_in_with_password.return_value = mock_res

        mock_query = MagicMock()
        mock_query.execute.return_value.data = {'name': 'John Doe', 'email': 'john@example.com'}
        mock_client.postgrest.auth.return_value.from_.return_value.select.return_value.eq.return_value.single.return_value = mock_query

        success, uid, name, email, token, err = service.sign_in('john@example.com', 'password123')
        self.assertTrue(success)
        self.assertEqual(uid, 'usr-uuid-1111-2222')
        self.assertEqual(name, 'John Doe')
        self.assertEqual(email, 'john@example.com')

    def test_04_fifteen_step_trip_lifecycle(self):
        """
        Tests the complete 15-step trip lifecycle.
        """
        service = SupabaseService()
        service.url = 'https://mockproject.supabase.co'
        service.key = 'mock-key-123'
        mock_client = MagicMock()
        service._client = mock_client

        # Mock database store in memory
        db_trips = []

        def mock_insert(payload):
            trip_id = f'trip-uuid-{len(db_trips) + 1}'
            row = dict(payload)
            row['id'] = trip_id
            db_trips.append(row)
            res = MagicMock()
            res.data = [row]
            return MagicMock(execute=lambda: res)

        def mock_select(fields='*'):
            class QueryBuilder:
                def __init__(self):
                    self.target_user = None
                    self.target_id = None
                def eq(self, col, val):
                    if col == 'user_id': self.target_user = val
                    elif col == 'id': self.target_id = val
                    return self
                def order(self, *args, **kwargs): return self
                def single(self): return self
                def execute(self):
                    res = MagicMock()
                    matched = [t for t in db_trips if (self.target_user is None or t['user_id'] == self.target_user) and (self.target_id is None or t['id'] == self.target_id)]
                    res.data = matched[0] if (self.target_id and matched) else matched
                    return res
            return QueryBuilder()

        def mock_delete():
            class DelBuilder:
                def __init__(self):
                    self.target_id = None
                    self.target_user = None
                def eq(self, col, val):
                    if col == 'id': self.target_id = val
                    elif col == 'user_id': self.target_user = val
                    return self
                def execute(self):
                    nonlocal db_trips
                    db_trips = [t for t in db_trips if not (t['id'] == self.target_id and t['user_id'] == self.target_user)]
                    return MagicMock()
            return DelBuilder()

        mock_client.table.side_effect = lambda name: MagicMock(
            insert=mock_insert,
            select=mock_select,
            delete=mock_delete
        )
        mock_client.postgrest.auth.return_value.from_.side_effect = lambda name: MagicMock(
            insert=mock_insert,
            select=mock_select,
            delete=mock_delete
        )

        user_id = 'user-uuid-step15'
        # 6. Create Trip 1
        s1, t1_id, e1 = service.create_trip(user_id, {'destination': 'Goa', 'start_date': '2026-10-01', 'end_date': '2026-10-05', 'travel_mode': 'Flight'}, {'total_weight': 6.5})
        self.assertTrue(s1)
        self.assertEqual(t1_id, 'trip-uuid-1')

        # 7. Verify Trip 1 exists
        t1 = service.get_trip_by_id(t1_id, user_id)
        self.assertIsNotNone(t1)
        self.assertEqual(t1['destination'], 'Goa')

        # 10 & 11. Open My Trips -> verify Trip 1 appears
        user_trips = service.get_user_trips(user_id)
        self.assertEqual(len(user_trips), 1)
        self.assertEqual(user_trips[0]['id'], t1_id)

        # 12. Create Trip 2
        s2, t2_id, e2 = service.create_trip(user_id, {'destination': 'Manali', 'start_date': '2026-12-10', 'end_date': '2026-12-15', 'travel_mode': 'Bus'}, {'total_weight': 10.0})
        self.assertTrue(s2)
        self.assertEqual(t2_id, 'trip-uuid-2')

        # 13. Verify both trips appear
        user_trips_2 = service.get_user_trips(user_id)
        self.assertEqual(len(user_trips_2), 2)
        destinations = [t['destination'] for t in user_trips_2]
        self.assertIn('Goa', destinations)
        self.assertIn('Manali', destinations)

        # 14. Delete Trip 1
        del_res = service.delete_trip(t1_id, user_id)
        self.assertTrue(del_res)

        # 15. Verify only Trip 1 is deleted
        remaining_trips = service.get_user_trips(user_id)
        self.assertEqual(len(remaining_trips), 1)
        self.assertEqual(remaining_trips[0]['id'], t2_id)
        self.assertEqual(remaining_trips[0]['destination'], 'Manali')

    def test_05_multi_user_isolation(self):
        """Verify strict multi-user isolation: User A sees only Trip A, User B sees only Trip B."""
        service = SupabaseService()
        service.url = 'https://mockproject.supabase.co'
        service.key = 'mock-key-123'
        mock_client = MagicMock()
        service._client = mock_client

        trips_db = [
            {'id': 'trip-A', 'user_id': 'user-A', 'destination': 'Tokyo'},
            {'id': 'trip-B', 'user_id': 'user-B', 'destination': 'London'},
        ]

        def mock_from(name):
            builder = MagicMock()
            def select_filter(*args, **kwargs):
                qb = MagicMock()
                def eq_filter(col, val):
                    matched = [t for t in trips_db if t.get(col) == val]
                    res = MagicMock()
                    res.data = matched
                    return MagicMock(order=lambda *a, **k: MagicMock(execute=lambda: res), execute=lambda: res)
                qb.eq = eq_filter
                return qb
            builder.select = select_filter

            def delete_filter():
                db = MagicMock()
                def eq_first(c1, v1):
                    def eq_second(c2, v2):
                        nonlocal trips_db
                        trips_db = [t for t in trips_db if not (t.get(c1) == v1 and t.get(c2) == v2)]
                        return MagicMock(execute=lambda: MagicMock())
                    return MagicMock(eq=eq_second)
                db.eq = eq_first
                return db
            builder.delete = delete_filter
            return builder

        mock_client.table.side_effect = mock_from
        mock_client.postgrest.auth.return_value.from_.side_effect = mock_from

        # User A queries trips
        trips_user_a = service.get_user_trips('user-A')
        self.assertEqual(len(trips_user_a), 1)
        self.assertEqual(trips_user_a[0]['destination'], 'Tokyo')

        # User B queries trips
        trips_user_b = service.get_user_trips('user-B')
        self.assertEqual(len(trips_user_b), 1)
        self.assertEqual(trips_user_b[0]['destination'], 'London')

        # User A attempts to delete User B's trip ('trip-B')
        service.delete_trip('trip-B', 'user-A')
        # Verify trip-B was NOT deleted because user_id did not match!
        remaining = [t for t in trips_db if t['id'] == 'trip-B']
        self.assertEqual(len(remaining), 1, 'User B trip should not be deleted by User A')

if __name__ == '__main__':
    unittest.main()
