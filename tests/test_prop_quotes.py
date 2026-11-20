import io
import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from src.ml.odds_client import OddsClient, OddsError, record_usage
from src.ml.refresh_props import refresh, normalize, can_request, MARKETS, QUOTE_COST, CACHE, STATE
from src.ml.refresh_performance import write_json

NOW = '2026-10-22T12:00:00+00:00'
START = '2026-10-25T17:00:00+00:00'
GAME = {'game_id':'2026_07_SEA_DEN','home_team':'DEN','away_team':'SEA'}
REPORT = {'kickoff':START,'scoring':{'home':{'team':'DEN'},'away':{'team':'SEA'}}}
EVENT = {'id':'event1','home_team':'Denver Broncos','away_team':'Seattle Seahawks','commence_time':START}
MARKET = {'key':'player_pass_yds','last_update':NOW,'outcomes':[{'name':'Over','description':'Bo Nix','point':225.5,'price':-110},{'name':'Under','description':'Bo Nix','point':225.5,'price':-110}]}
QUOTE = {**EVENT,'bookmakers':[{'key':'draftkings','markets':[MARKET]}]}

class FakeClient:
    def __init__(self, remaining=455, last_cost=4, fail=False, events=None):
        self.remaining, self.last_cost, self.fail = remaining, last_cost, fail
        self.events = events if events is not None else [EVENT]
        self.calls = []
    def now(self): return NOW
    def balance(self): self.calls.append('balance'); return {'remaining':self.remaining}
    def request(self, path, params=None, kind=None):
        self.calls.append(kind)
        if kind == 'event_discovery': return self.events, {'remaining':self.remaining}
        if self.fail: raise OddsError('network unavailable')
        self.remaining -= self.last_cost or 0
        event=next((e for e in self.events if f"/{e['id']}/odds/" in path),EVENT)
        return {**QUOTE,**event}, {'remaining':self.remaining,'last_cost':self.last_cost,'observed_at':NOW}

class PropTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        write_json(self.root/'frontend/public/predictions.json', {'season':2026,'week':7,'games':[GAME]})
        write_json(self.root/'frontend/public/research/2026-week-7.json', {'season':2026,'week':7,'games':{GAME['game_id']:REPORT}})
    def tearDown(self): self.tmp.cleanup()
    def test_balance_and_event_discovery_are_free_and_prop_attempt_is_cached_once(self):
        client=FakeClient(); output=refresh(self.root,client,NOW)
        self.assertEqual(client.calls,['balance','event_discovery','player_props'])
        self.assertEqual(output['weekly_reserved'],QUOTE_COST)
        self.assertEqual(output['games'][GAME['game_id']]['markets'][0]['outcomes'][0]['point'],225.5)
        second=FakeClient(); self.assertEqual(refresh(self.root,second,NOW)['status'],'cached'); self.assertEqual(second.calls,[])
    def test_budget_boundary_unknown_balance_and_monthly_weekly_caps_fail_closed(self):
        self.assertTrue(can_request({'remaining':100+QUOTE_COST},64-QUOTE_COST,320-QUOTE_COST))
        for balance,week,month in [(103,0,0),(None,0,0),(True,0,0),(455,64,0),(455,0,320)]:
            self.assertFalse(can_request({'remaining':balance},week,month))
        client=FakeClient(103); self.assertEqual(refresh(self.root,client,NOW)['status'],'budget_blocked'); self.assertEqual(client.calls,['balance'])
    def test_failure_reserves_credits_and_never_retries_an_ambiguous_charge(self):
        client=FakeClient(fail=True); self.assertEqual(refresh(self.root,client,NOW)['status'],'partial_failure')
        state=json.loads((self.root/STATE).read_text()); self.assertEqual(next(iter(state['attempts'].values()))['reserved'],QUOTE_COST)
        again=FakeClient(); refresh(self.root,again,NOW); self.assertEqual(again.calls,[])
    def test_slate_cap_survives_larger_market_bundle(self):
        from datetime import datetime, timedelta
        games, reports, events = [], {}, []
        for n in range(17):
            game={**GAME,'game_id':f'game{n}'}
            kickoff=(datetime.fromisoformat(START)+timedelta(minutes=n)).isoformat()
            games.append(game); reports[game['game_id']]={**REPORT,'kickoff':kickoff}
            events.append({**EVENT,'id':f'event{n}','commence_time':kickoff})
        write_json(self.root/'frontend/public/predictions.json',{'season':2026,'week':7,'games':games})
        write_json(self.root/'frontend/public/research/2026-week-7.json',{'season':2026,'week':7,'games':reports})
        client=FakeClient(events=events); output=refresh(self.root,client,NOW)
        self.assertEqual(client.calls.count('player_props'),64//QUOTE_COST); self.assertEqual(output['weekly_reserved'],64//QUOTE_COST*QUOTE_COST)
        again=FakeClient(events=events); refresh(self.root,again,NOW); self.assertEqual(again.calls,['balance'])

    def test_identity_and_kickoff_mismatch_do_not_spend_credits(self):
        for changed in [{'commence_time':'2026-10-26T17:00:00Z'},{'home_team':'Wrong'},{'id':'../evil'}]:
            client=FakeClient(events=[{**EVENT,**changed}]); refresh(self.root,client,NOW); self.assertNotIn('player_props',client.calls)
        with self.assertRaises(ValueError): normalize({**QUOTE,'home_team':'Wrong'},GAME,REPORT,NOW)
    def test_no_extra_market_or_bookmaker_and_invalid_outcomes_are_rejected(self):
        bad=[{'name':'Over','description':'Bo Nix','point':100,'price':99},{'name':'Over','description':'Bo Nix','point':float('nan'),'price':-110}]
        response={**QUOTE,'bookmakers':[{'key':'other','markets':[MARKET]},{'key':'draftkings','markets':[{**MARKET,'outcomes':MARKET['outcomes']+bad},{**MARKET,'key':'player_pass_tds'}]}]}
        quote=normalize(response,GAME,REPORT,NOW); self.assertEqual(len(quote['markets']),1); self.assertEqual(len(quote['markets'][0]['outcomes']),2)
        self.assertIn('player_pass_attempts_alternate', MARKETS)
        self.assertIn('player_pass_tds_alternate', MARKETS)
        fan = normalize({**QUOTE,'bookmakers':[*QUOTE['bookmakers'],{'key':'fanduel','markets':[MARKET]}]},GAME,REPORT,NOW)
        self.assertEqual(fan['by_book']['fanduel'],fan['markets'])
    def test_wrong_week_past_games_early_week_and_corrupt_ledger_make_no_requests(self):
        for date in ['2026-10-20T12:00:00Z','2026-10-27T12:00:00Z']:
            client=FakeClient(); refresh(self.root,client,date); self.assertEqual(client.calls,[])
        write_json(self.root/STATE,{'schema_version':1,'attempts':{'bad':{'reserved':-1}}})
        client=FakeClient()
        with self.assertRaises(ValueError): refresh(self.root,client,NOW)
        self.assertEqual(client.calls,[])
    def test_unknown_returned_cost_stops_further_calls(self):
        client=FakeClient(last_cost=None); self.assertEqual(refresh(self.root,client,NOW)['status'],'usage_unverified')
    def test_headers_are_saved_without_credentials_and_missing_headers_stay_unknown(self):
        saved=record_usage({'x-requests-remaining':'455','x-requests-used':'45','x-requests-last':'0'},'balance',self.root,NOW)
        self.assertEqual(saved['remaining'],455); self.assertEqual(saved['last_cost'],0)
        self.assertIsNone(record_usage({},'balance',self.root,NOW)['remaining'])
        self.assertNotIn('apiKey',(self.root/'frontend/public/odds_usage.json').read_text())
    def test_client_free_balance_endpoint_and_errors_never_expose_secret_url(self):
        secret='test-secret-key'
        class Response(io.StringIO): headers={'x-requests-remaining':'455','x-requests-last':'0'}
        seen=[]
        def opener(url,timeout): seen.append(url); return Response('[]')
        client=OddsClient(secret,self.root,opener,lambda:NOW); self.assertEqual(client.balance()['remaining'],455)
        self.assertIn('/v4/sports/?',seen[0]); self.assertNotIn('/odds',seen[0])
        for error in [URLError(f'bad {secret}'),HTTPError('https://example?apiKey='+secret,401,'bad',{},None)]:
            def broken(url,timeout): raise error
            with self.assertRaises(OddsError) as caught: OddsClient(secret,self.root,broken).balance()
            self.assertNotIn(secret,str(caught.exception))
