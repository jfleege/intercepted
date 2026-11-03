"""Timestamped pregame depth evidence; untimed legacy rows cannot train role adjustments."""
from collections import defaultdict
from bisect import bisect_right
from datetime import datetime
from src.features.player_context import within, finite
from src.ml.projection_features import team_name

class Roles:
    def __init__(self, rows):
        grouped=defaultdict(lambda:defaultdict(set))
        for r in rows:
            at=r.get('dt');rank=r.get('pos_rank');pid=r.get('gsis_id');team=team_name(r.get('team'));position=r.get('pos_abb')
            if position not in ('QB','RB','WR','TE') or not pid or not team or not at or not finite(rank) or rank<1:continue
            if isinstance(at,datetime):at=at.isoformat()
            from src.ml.refresh_performance import stamp
            try: at=stamp(at).isoformat()
            except (ValueError,TypeError):continue
            grouped[(team,pid,position)][at].add(int(rank))
        self.groups={key:sorted(values.items()) for key,values in grouped.items()}
    def lookup(self,team,pid,kickoff,position="QB"):
        from src.ml.refresh_performance import stamp
        rows=self.groups.get((team_name(team),pid,position),[])
        time=stamp(kickoff).isoformat();times=[r[0] for r in rows]
        i=bisect_right(times,time)-1
        if i<0:return None
        at,ranks=rows[i]
        if at==time or not within(at,time) or len(ranks)!=1:return None
        return {'rank':next(iter(ranks)),'observed_at':at}
