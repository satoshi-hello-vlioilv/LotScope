# -*- coding: utf-8 -*-
"""現場のマスタ（設備・ロール）の読み書き・マスタの置き場の状態。アクセス権限マスタは access.py。"""
from ..web import current_app, jsonify, request

from ..services import master_place
from .common import base_rev, bp, master_call, master_repo, req_body

# マスタごとの API（設備: 設備名が必須／ロール: 設備が必須）
MASTER_APIS = {
    "equipment": ("equipment", "設備名"),
    "rolls": ("rolls", "設備"),
}


def _blank(v):
    """必須の列が空か（null も空。版 3.77.0: 前は null を「None」と読んで通し、名前の空の行を置いた）。0 や False は空でない（str() の字）"""
    return v is None or not str(v).strip()


def _payload(required):
    data = req_body()
    data.pop("base_rev", None)
    if required in data and _blank(data.get(required)):
        raise ValueError(f"{required}は必須です。")
    return data


_NAMES = {"equipment": "equipment_master", "rolls": "roll_master"}


def _register_master_api(kind, prefix, required):
    url = f"/api/masters/{kind}"

    def list_():
        # 読めない行は隔てる（版 3.107.0。答えは行の並びのまま。隔てた行はマスタの置き場の状態の skipped が言う）
        return master_call(lambda: master_repo().view(_NAMES[prefix])[0])

    def create():
        def run():
            data = _payload(required)
            if _blank(data.get(required)):   # 追加は必須の列を省けない
                raise ValueError(f"{required}は必須です。")
            return getattr(master_repo(), f"{prefix}_create")(data)
        return master_call(run, 201)

    def update(item_id):
        base = base_rev()
        return master_call(lambda: getattr(master_repo(), f"{prefix}_update")(item_id, _payload(required), base))

    def delete(item_id):
        base = base_rev()

        def run():
            getattr(master_repo(), f"{prefix}_delete")(item_id, base)
            return {"status": "deleted", "id": item_id}
        return master_call(run)

    bp.add_url_rule(url, f"{kind}_list", list_, methods=["GET"])
    bp.add_url_rule(url, f"{kind}_create", create, methods=["POST"])
    bp.add_url_rule(f"{url}/<int:item_id>", f"{kind}_update", update, methods=["PUT"])
    bp.add_url_rule(f"{url}/<int:item_id>", f"{kind}_delete", delete, methods=["DELETE"])


for _kind, (_prefix, _required) in MASTER_APIS.items():
    _register_master_api(_kind, _prefix, _required)


@bp.post("/api/equipment/inspection")
def equipment_inspection():
    """{names: [...]} → {inspection: {設備名: 検査計があるか}}。画面が発見設備を自動で選ぶ（実績のうち検査計がある最後の設備）ため。"""
    names = [str(n) for n in ((req_body()).get("names") or [])][:100]
    return master_call(lambda: {"inspection": master_repo().inspection_of(names)})


@bp.delete("/api/masters/rows/<name>/<int:row>")
def masters_row_delete(name, row):
    """読めない行を何行目かで消す（版 3.108.0。知らせの面の × から。?summary= は面に出した生の値の要約で、違えば消さない）。
    id で引けない行（id が字）・表でない行も消せる。書けるかは門番（routes/access.py。道のマスタの名前で見る）"""
    from ..repositories.master_repository import ROW_DELETE
    if name not in ROW_DELETE:
        return jsonify({"error": f"{name} の読めない行は、ここからは消せません（ファイルを直してください）。", "kind": "not_found"}), 404
    summary = request.args.get("summary", "")
    return master_call(lambda: {"ok": True, **master_repo().delete_unreadable_row(name, row, summary)})


@bp.get("/api/masters/status")
def masters_status():
    """置き場（手元／共有）・共有へ届くか・錠・各マスタの版。画面はこれで「いつの・どこの」マスタかを言う。
    置き場がクラウドの同期フォルダなら、注意（caution）も返す（同時の保存で片方が消えうる）。
    共有が master_place.SHARE_PROBE_SEC 秒で答えなければ、写しで答えて reachable を null（確かめ中）にする（版 3.100.0）"""
    return jsonify(master_place.status(current_app.config["MASTER_STORE"]))   # 共有を見るのは区切った秒まで（版 3.100.0）
