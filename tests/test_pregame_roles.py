import unittest
from src.features.pregame_roles import Roles
class RoleTests(unittest.TestCase):
 def row(self,**kw):return dict(dt='2026-10-28T12:00:00Z',team='TB',gsis_id='p',pos_rank=1,**kw)
 def test_only_timestamped_unique_fresh_pregame_roles(self):
  before={'dt':'2026-10-28T12:00:00Z','team':'TB','gsis_id':'p','pos_rank':1}
  self.assertEqual(Roles([before]).lookup('TB','p','2026-10-29T12:00:00Z')['rank'],1)
  self.assertIsNone(Roles([before]).lookup('TB','p','2026-10-28T12:00:00Z'))
  self.assertIsNone(Roles([before]).lookup('TB','p','2026-11-01T12:00:00Z'))
  self.assertIsNone(Roles([{**before,'dt':None}]).lookup('TB','p','2026-10-29T12:00:00Z'))
  self.assertIsNone(Roles([before,{**before,'pos_rank':2}]).lookup('TB','p','2026-10-29T12:00:00Z'))
  self.assertIsNone(Roles([before]).lookup('ATL','p','2026-10-29T12:00:00Z'))
