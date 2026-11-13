/**
 * dsh-sidebar-marks — 显示侧（client half）。
 *
 *   - 启动时探测本机端口（49397 起），找到自己的主控侧再开始工作
 *   - 拉 /marks 拿标记数据，订阅 /stream 接收变更
 *   - 在会话行的官方图钉前插入圆点；认不出是哪条会话就不画
 *
 * 规范要求：必须导出 apply(ctx) 与 inject，且 apply 内不得抛出。
 */

window.__ModuleLoader__.load({
	id: "dsh-sidebar-marks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var API = "http://127.0.0.1:49397";
		var mar = null;

		// 最早期探针：只要这个文件被前端加载，就会打这一行回来。
		function ensureCss() {
			try {
				if (document.querySelector('style[data-dsm-marks]')) return;
				var s = document.createElement("style");
				s.setAttribute("data-dsm-marks", "1");
				s.textContent =
					".dsm-dot{display:inline-block;width:var(--dsm-dot-size,7px);height:var(--dsm-dot-size,7px);border-radius:50%;" +
					"margin-right:var(--dsm-dot-gap,7px);flex:none;vertical-align:middle;position:relative;top:var(--dsm-dot-top,-1.5px);" +
					"align-self:center;opacity:var(--dsm-dot-opacity,1);box-shadow:0 0 0 1px rgba(0,0,0,.16)}" +
					".dsm-dot[data-k=later]{background:var(--dsm-c-later,#ec7a70)}" +
					".dsm-dot[data-k=favorite]{background:var(--dsm-c-favorite,#d9a94e)}" +
					".dsm-dot-attitude{flex:0 0 auto}" +
					".dsm-dot-tag{background:transparent;border:calc(var(--dsm-tag-ring,2px)) solid var(--dsm-c-tag,#8fb8d9);box-sizing:border-box;margin-left:var(--dsm-tag-gap,5px);flex:0 0 auto}" +
					// 没有钉子的行，用一个和钉子同尺寸的透明占位撑住，让我们的点永远落在同一列
					".dsm-spacer{display:inline-block;width:16px;height:1px;margin-left:6px;flex:none;pointer-events:none}" +
					// 鼠标贴到行上（官方露出三个按钮）或被打开菜单时，我们的点让位
					'[class*="sessionRow"]:hover .dsm-dot:not(.dsm-dot-group),' +
					'[class*="sessionRow"][class*="menuOpen"] .dsm-dot:not(.dsm-dot-group)' +
					'{display:none}' +
					".dsm-dot-group{width:var(--dsm-dot-group-size,6px);height:var(--dsm-dot-group-size,6px);margin-right:var(--dsm-dot-group-gap,5px);opacity:calc(var(--dsm-dot-opacity,1) * .85)}" +
					".dsm-dot-group.is-open{width:var(--dsm-dot-group-open-size,3px);height:var(--dsm-dot-group-open-size,3px);margin-right:var(--dsm-dot-group-open-gap,4px);opacity:calc(var(--dsm-dot-opacity,1) * .4)}";
				document.head.appendChild(s);
			} catch (e) {}
		}

		function reactPropsOf(el) {
			for (var k in el) {
				if (k.indexOf("__reactProps$") === 0) return el[k];
			}
			return null;
		}

		function reactFiberOf(el) {
			for (var k in el) {
				if (k.indexOf("__reactFiber$") === 0) return el[k];
			}
			return null;
		}

		/** 从 React props / fiber 链里找一个像 sessionId 的字符串 */
		function findSessionId(el) {
			var seen = 0;
			var p = reactPropsOf(el);
			var stack = [];
			if (p) stack.push(p);
			while (stack.length && seen < 40) {
				var cur = stack.shift();
				seen += 1;
				if (!cur || typeof cur !== "object") continue;
				for (var key in cur) {
					var v;
					try { v = cur[key]; } catch (e) { continue; }
					if (typeof v === "string" && /^session-[0-9a-f]{8}/i.test(v)) return v;
					if (v && typeof v === "object" && !Array.isArray(v) && seen < 20) {
						if (typeof v.id === "string" && /^session-[0-9a-f]{8}/i.test(v.id)) return v.id;
						if (typeof v.sessionId === "string" && /^session-[0-9a-f]{8}/i.test(v.sessionId)) return v.sessionId;
					}
				}
			}
			// fiber 往上一层找 memoizedProps
			try {
				var f = reactFiberOf(el);
				var hops = 0;
				while (f && hops < 8) {
					var mp = f.memoizedProps;
					if (mp && typeof mp === "object") {
						for (var k2 in mp) {
							var v2 = mp[k2];
							if (typeof v2 === "string" && /^session-[0-9a-f]{8}/i.test(v2)) return v2;
							if (v2 && typeof v2 === "object") {
								if (typeof v2.id === "string" && /^session-[0-9a-f]{8}/i.test(v2.id)) return v2.id;
								if (typeof v2.sessionId === "string" && /^session-[0-9a-f]{8}/i.test(v2.sessionId)) return v2.sessionId;
							}
						}
					}
					f = f.return;
					hops += 1;
				}
			} catch (e) {}
			return null;
		}

		function scan() {
			var out = { titled: 0, rows: [], sessions: null };
			// sessions 服务快照（如果 inject 拿到）
			try {
				if (mar && mar.ctx && mar.ctx.sessions) {
					var snap = null;
					try { snap = mar.ctx.sessions.list.getSnapshot(); } catch (e) {}
					if (snap && typeof snap === "object") {
						out.sessions = {
							keys: Object.keys(snap).slice(0, 10),
							sample: JSON.parse(JSON.stringify(snap, function (k, v) {
								if (typeof v === "function") return "[fn]";
								if (typeof v === "string" && v.length > 80) return v.slice(0, 80);
								return v;
							})),
						};
						if (Array.isArray(out.sessions.sample)) out.sessions.sample = out.sessions.sample.slice(0, 3);
					}
				}
			} catch (e) {
				out.sessions = { error: String(e && e.message) };
			}
			// 侧栏结构专项探测
			try {
				var sb = document.querySelector('[data-testid=sidebar]')
					|| document.querySelector('[data-dsh-sidebar]')
					|| document.querySelector('.dsw-sidebar')
					|| document.querySelector('aside');
				if (sb) {
					out.sidebar = {
						found: true,
						cls: String(sb.className || "").slice(0, 120),
						html: String(sb.outerHTML || "").slice(0, 1200),
						clickables: [],
					};
					var cs = sb.querySelectorAll('button, a, [role="button"], [tabindex]');
					for (var ci = 0; ci < cs.length && out.sidebar.clickables.length < 30; ci++) {
						var c = cs[ci];
						var cr = c.getBoundingClientRect();
						out.sidebar.clickables.push({
							tag: c.tagName,
							cls: String(c.className || "").slice(0, 70),
							title: c.getAttribute("title"),
							text: (c.textContent || "").trim().slice(0, 40),
							rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
							sid: findSessionId(c),
						});
					}
				} else {
					out.sidebar = { found: false };
				}
			} catch (e) {
				out.sidebar = { error: String(e && e.message) };
			}
			var nodes = document.querySelectorAll("[title]");
			out.titled = nodes.length;
			for (var i = 0; i < nodes.length && out.rows.length < 40; i++) {
				var el = nodes[i];
				var r = el.getBoundingClientRect();
				if (r.width < 20 || r.height < 10) continue;
				var text = (el.textContent || "").trim();
				out.rows.push({
					tag: el.tagName,
					cls: String(el.className || "").slice(0, 90),
					title: el.getAttribute("title"),
					text: text.slice(0, 50),
					rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
					sid: findSessionId(el),
				});
			}
			return out;
		}

		var markMap = {};
		var tagPalette = null;
		// 显示模式与优先级（来自 style.json，取色器页面可改）
		var styleDisplayMode = "all";
		var stylePriority = ["later", "favorite", "tag"];
		// 折叠后 DOM 里没有子会话行了，靠展开时记下的映射表顶上
		var groupCache = {};

		function hashStr(str) {
			var h = 0;
			for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
			return h;
		}

		function loadMarks(cb) {
			try {
				fetch(API + "/marks").then(function (r) { return r.json(); }).then(function (j) {
					var out = {};
					var ss = (j && j.sessions) || {};
					Object.keys(ss).forEach(function (sid) {
						var m = ss[sid] || {};
						var ms = m.marks || [];
						// 三个独立维度：待回看 / 收藏 / 标签，可以任意组合并存
						var kinds = [];
						if (ms.indexOf("later") >= 0) kinds.push("later");
						if (ms.indexOf("favorite") >= 0) kinds.push("favorite");
						var tags = m.tags || [];
						var tag = tags.length ? String(tags[0]) : "";
						if (tag) kinds.push("tag");
						if (!kinds.length) return;
						out[sid] = { kinds: kinds, tag: tag };
					});
					markMap = out;
					if (cb) cb();
				}).catch(function () {});
			} catch (e) {}
		}

		// 工作区分组标题：无 sessionId、文本短、位于左侧的行
		function findGroups(sessionRows) {
			var root = document.querySelector("aside")
				|| document.querySelector('[class*="sidebar"]')
				|| document.body;
			var els = root.querySelectorAll("*");
			var cands = [];
			for (var i = 0; i < els.length; i++) {
				var el = els[i];
				var r = el.getBoundingClientRect();
				if (r.height < 14 || r.height > 42 || r.width < 30) continue;
				if (r.x > 460 || r.x < 0 || r.y < 0) continue;
				var text = (el.textContent || "").trim();
				if (!text || text.length > 24) continue;
				if (findSessionId(el)) continue;
				cands.push({ el: el, y: r.y, h: r.height, text: text, x: r.x });
			}
			// 去重：同一 y 只留最内层
			var seen = {};
			var groups = [];
			cands.sort(function (a, b) { return a.y - b.y; });
			for (var c = 0; c < cands.length; c++) {
				var key = Math.round(cands[c].y);
				if (seen[key]) continue;
				seen[key] = 1;
				groups.push(cands[c]);
			}
			// 给每个组分配它下面的会话行（到下个组为止）
			for (var g = 0; g < groups.length; g++) {
				var top = groups[g].y;
				var bottom = g + 1 < groups.length ? groups[g + 1].y : 1e9;
				groups[g].sids = [];
				for (var r2 = 0; r2 < sessionRows.length; r2++) {
					var sy = sessionRows[r2].y;
					if (sy > top && sy < bottom) groups[g].sids.push(sessionRows[r2].sid);
				}
			}
			return groups;
		}

		function findRows() {
			var root = document.querySelector("aside")
				|| document.querySelector('[class*="sidebar"]')
				|| document.body;
			var els = root.querySelectorAll("*");
			var bySid = {};
			for (var i = 0; i < els.length; i++) {
				var el = els[i];
				var r = el.getBoundingClientRect();
				if (r.width < 40 || r.height < 12 || r.height > 48) continue;
				if (r.x > 460 || r.x < 0 || r.y < 0) continue;
				var text = (el.textContent || "").trim();
				if (!text || text.length > 70) continue;
				var sid = findSessionId(el);
				if (!sid) continue;
				// 评分：子元素越少越内层；文字越短越像"标题"而不是"标题+时间"
				var score = el.children.length * 1000 + text.length;
				var prev = bySid[sid];
				if (!prev || score < prev.score) {
					bySid[sid] = { el: el, sid: sid, score: score, y: r.y, text: text.slice(0, 30) };
				}
			}
			var out = [];
			for (var k in bySid) if (Object.prototype.hasOwnProperty.call(bySid, k)) out.push(bySid[k]);
			return out;
		}

		var rendering = false;
		// 结构诊断配额：只上报前 4 行，排查完置 0 或删除整段

		function render() {
			if (rendering) return { rows: 0, painted: 0, sample: [] };
			rendering = true;
			try {
				return renderInner();
			} finally {
				rendering = false;
			}
		}

		/**
		 * 找到「会话行容器」（CSS Modules 类名形如 JoiKIa_sessionRow，hash 前缀会随版本变，
		 * 所以只认语义后缀 _sessionRow）。找到后我们就能把标记点插到行的右侧，
		 * 既不占标题宽度（标题才能对齐），也不跟左侧官方状态点位撞车。
		 */
		function rowHostOf(el) {
			try {
				// 1) 按语义后缀找行容器（hash 前缀会随 DSH 版本变，后缀稳定）
				var n = el;
				for (var i = 0; i < 8 && n; i++) {
					if (String(n.className || "").indexOf("sessionRow") > -1) return n;
					n = n.parentElement;
				}
				// 2) 退路：行容器的直接子元素里有 rowActions，谁含它谁就是行容器
				n = el;
				for (var k = 0; k < 8 && n; k++) {
					if (n.querySelector && n.querySelector('[class*="rowActions"]')) return n;
					n = n.parentElement;
				}
			} catch (e) {}
			return null;
		}

		function renderInner() {
			var rows = findRows();
			var painted = 0;
			var keep = {};
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				var info = markMap[row.sid];
				if (!info) continue;
				// 先清掉这一行里所有已有的点和占位，再重建
				var rowHost = rowHostOf(row.el);
				var scope = rowHost || row.el;
				var olds = scope.querySelectorAll(".dsm-dot, .dsm-spacer");
				for (var j = 0; j < olds.length; j++) {
					if (olds[j].parentNode) olds[j].parentNode.removeChild(olds[j]);
				}
				// 插入锚点。行结构（来自 dsh-client-ui-workspace 源码）：
				//   [span.slot][span.title][span.time][span.pinIndicator][span.rowActions]
				// 五者都是行容器的直接子元素。钉子存在就插在钉子左边；
				// 钉子不存在时插在操作区左边，并补一个和钉子同尺寸的透明占位，
				// 这样有没有钉子的行，我们的点都落在同一列。
				var pinEl = rowHost ? rowHost.querySelector('[class*="pinIndicator"]') : null;
				var anchorEl = pinEl || (rowHost ? rowHost.querySelector('[class*="rowActions"]') : null);

				// 决定这一行画哪几个点
				var order = (stylePriority && stylePriority.length === 3) ? stylePriority : ["later", "favorite", "tag"];
				var show = (info.kinds || []).slice();
				show.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
				if (styleDisplayMode === "single") {
					for (var pi = 0; pi < order.length; pi++) {
						if (show.indexOf(order[pi]) >= 0) { show = [order[pi]]; break; }
					}
				}
				if (!show.length) continue;

				// 逆序插入，最终顺序 = [点...][占位][锚点]
				var nodes = [];
				for (var si = 0; si < show.length; si++) {
					var kind = show[si];
					var node;
					if (kind === "tag") {
						var pal = tagPalette && tagPalette.length ? tagPalette : ["#8fb8d9"];
						node = document.createElement("span");
						node.className = "dsm-dot dsm-dot-tag";
						node.setAttribute("data-k", "tag");
						node.style.borderColor = pal[hashStr(info.tag) % pal.length];
						node.title = "标签：" + info.tag;
					} else {
						node = document.createElement("span");
						node.className = "dsm-dot dsm-dot-attitude";
						node.setAttribute("data-k", kind);
						node.title = kind === "later" ? "待回看" : "收藏";
					}
					node.setAttribute("data-sid", row.sid);
					nodes.push(node);
				}
				// 没有钉子时，我们自己让出钉子的宽度（16px 宽 + 左右各 6px 间距 = 28px），
				// 这样有没有钉子的行，点都落在同一条竖线上。
				// 不能依赖"找到操作区"——有的行两个锚点都找不到，点会被甩到最右边。
				if (!pinEl && nodes.length) {
					nodes[nodes.length - 1].style.marginRight = "28px";
				}
				if (anchorEl && anchorEl.parentNode) {
					var parent = anchorEl.parentNode;
					for (var ni = nodes.length - 1; ni >= 0; ni--) parent.insertBefore(nodes[ni], anchorEl);
				} else if (rowHost) {
					for (var nj = 0; nj < nodes.length; nj++) rowHost.appendChild(nodes[nj]);
				} else {
					for (var nk = 0; nk < nodes.length; nk++) row.el.appendChild(nodes[nk]);
				}
				keep[row.sid] = 1;
				painted++;
			}
			// 分组标题：组内有标记会话时也画一个点
			var groups = [];
			try { groups = findGroups(rows); } catch (e) {}
			for (var gi = 0; gi < groups.length; gi++) {
				var grp = groups[gi];
				var expanded = grp.sids.length > 0;
				if (expanded) {
					if (!groupCache[grp.text]) groupCache[grp.text] = {};
					for (var sc = 0; sc < grp.sids.length; sc++) groupCache[grp.text][grp.sids[sc]] = 1;
				}
				var sidList = expanded ? grp.sids : Object.keys(groupCache[grp.text] || {});
				var orderG = (stylePriority && stylePriority.length === 3) ? stylePriority : ["later", "favorite", "tag"];
				var bits = {};
				var bestKind = null;
				var bestTag = "";
				for (var sj = 0; sj < sidList.length; sj++) {
					var inf = markMap[sidList[sj]];
					if (!inf) continue;
					var ks = inf.kinds || [];
					for (var qi = 0; qi < orderG.length; qi++) {
						var kq = orderG[qi];
						if (ks.indexOf(kq) < 0) continue;
						bits[kq] = 1;
						if (bestKind === null || orderG.indexOf(kq) < orderG.indexOf(bestKind)) bestKind = kq;
					}
					if (inf.tag && !bestTag) bestTag = inf.tag;
				}
				var showG = [];
				if (styleDisplayMode === "single") {
					if (bestKind) showG = [bestKind];
				} else {
					for (var qj = 0; qj < orderG.length; qj++) if (bits[orderG[qj]]) showG.push(orderG[qj]);
				}
				var oldG = grp.el.querySelectorAll(".dsm-dot[data-g]");
				for (var og = 0; og < oldG.length; og++) if (oldG[og].parentNode === grp.el) oldG[og].parentNode.removeChild(oldG[og]);
				if (!showG.length) continue;
				var gcls = "dsm-dot dsm-dot-group" + (expanded ? " is-open" : "");
				for (var sg = 0; sg < showG.length; sg++) {
					var gk = showG[sg];
					var gd = document.createElement("span");
					gd.className = gcls + (gk === "tag" ? " dsm-dot-tag" : " dsm-dot-attitude");
					gd.setAttribute("data-k", gk);
					gd.setAttribute("data-g", "1");
					if (gk === "tag") {
						var pal2 = tagPalette && tagPalette.length ? tagPalette : ["#8fb8d9"];
						gd.style.borderColor = pal2[hashStr(bestTag) % pal2.length];
						gd.title = "这个工作区有带标签的任务";
						grp.el.appendChild(gd);
					} else {
						gd.title = "这个工作区有" + (gk === "later" ? "待回看" : "收藏") + "的任务";
						grp.el.insertBefore(gd, grp.el.firstChild);
					}
				}
			}

			// 清理孤儿点：整页扫描一次，行已经不在列表里的点删掉
			var all = document.querySelectorAll(".dsm-dot");
			for (var k = 0; k < all.length; k++) {
				var host = all[k].parentNode;
				if (!host) continue;
				var sid = findSessionId(host);
				if (!sid || !keep[sid]) all[k].parentNode.removeChild(all[k]);
			}
			return { rows: rows.length, painted: painted, sample: rows.slice(0, 5).map(function (x) { return { text: x.text, sid: x.sid.slice(0, 22) }; }) };
		}

		// 视觉参数由主控侧 /style 提供，改 style.json 即可热更新，无需重启 DSH
		function applyStyle() {
			try {
				fetch(API + "/style").then(function (r) { return r.json(); }).then(function (j) {
					var st = (j && j.style) || {};
					var el = document.documentElement;
					if (st.dotSize != null) el.style.setProperty("--dsm-dot-size", st.dotSize + "px");
					if (st.dotTop != null) el.style.setProperty("--dsm-dot-top", st.dotTop + "px");
					if (st.dotGap != null) el.style.setProperty("--dsm-dot-gap", st.dotGap + "px");
					if (st.dotShift != null) el.style.setProperty("--dsm-dot-shift", st.dotShift + "px");
					if (st.dotLeft != null) el.style.setProperty("--dsm-dot-left", st.dotLeft + "px");
					if (st.dotOpacity != null) el.style.setProperty("--dsm-dot-opacity", String(st.dotOpacity));
					if (st.colorLater) el.style.setProperty("--dsm-c-later", st.colorLater);
					if (st.colorFavorite) el.style.setProperty("--dsm-c-favorite", st.colorFavorite);
					if (st.colorTag) el.style.setProperty("--dsm-c-tag", st.colorTag);
					if (Array.isArray(st.tagPalette) && st.tagPalette.length) tagPalette = st.tagPalette;
					// 显示模式与优先级：改了要立刻重画，否则要等下一轮 DOM 变化
					var modeChanged = false;
					if (st.displayMode === "single" || st.displayMode === "all") {
						if (st.displayMode !== styleDisplayMode) modeChanged = true;
						styleDisplayMode = st.displayMode;
					}
					if (Array.isArray(st.priority) && st.priority.length === 3) {
						if (st.priority.join(",") !== (stylePriority || []).join(",")) modeChanged = true;
						stylePriority = st.priority;
					}
					if (modeChanged) render();
				}).catch(function () {});
			} catch (e) {}
		}

		// SSE：主控侧盯住标注文件，一变就推；连不上就退回定时轮询
		var es = null;

		function startStream() {
			try {
				if (typeof EventSource === "undefined") return;
				es = new EventSource(API + "/stream");
				es.addEventListener("changed", function () { tick(); });
				es.onerror = function () {};
			} catch (e) {}
		}

		// ——— 会话悬停卡片里的标记控件 ———
		// 官方在侧栏会话行 hover 时弹出一张信息卡，底部有 renderSlot("sidebar.session.row.hover")。
		// 我们不去加按钮，而是把控件追加到这张卡片里，位置天然属于「这一条会话」。
		var HOVER_ATTR = "data-dsm-hover";

		function ensureHoverCss() {
			try {
				if (document.querySelector("style[data-dsm-hover-css]")) return;
				var st = document.createElement("style");
				st.setAttribute("data-dsm-hover-css", "1");
				st.textContent =
					".dsm-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:8px;margin-top:8px;" +
					"border-top:1px solid rgba(255,255,255,.10);font-size:11px}" +
					".dsm-act{font:inherit;font-size:11px;line-height:1;padding:3px 8px;border-radius:5px;cursor:pointer;" +
					"border:1px solid rgba(255,255,255,.16);background:transparent;color:inherit;opacity:.7}" +
					".dsm-act:hover{opacity:1}" +
					".dsm-act.is-on{opacity:1}" +
					'.dsm-act[data-k=reviewLater].is-on{color:var(--dsm-c-later,#ec7a70);border-color:var(--dsm-c-later,#ec7a70)}' +
					'.dsm-act[data-k=favorite].is-on{color:var(--dsm-c-favorite,#d9a94e);border-color:var(--dsm-c-favorite,#d9a94e)}' +
					".dsm-tag-input{font:inherit;font-size:11px;width:92px;padding:3px 7px;border-radius:5px;outline:none;" +
					"border:1px solid rgba(255,255,255,.16);background:transparent;color:inherit}" +
					".dsm-tag-input:focus{border-color:rgba(255,255,255,.38)}" +
					".dsm-act-danger{color:#e06c75;opacity:.85}" +
					".dsm-act-danger:hover{opacity:1;border-color:#e06c75}" +
					".dsm-act-danger:disabled{opacity:.5;cursor:default}";
				document.head.appendChild(st);
			} catch (e) {}
		}

		/** 从 React fiber 上反查这张卡片属于哪条会话；认不出就返回 null。 */
		function sessionIdOf(el) {
			var key = null;
			for (var k in el) {
				if (k.indexOf("__reactFiber$") === 0) { key = k; break; }
			}
			if (!key) return null;
			var f = el[key];
			var rowAt = -1;
			for (var i = 0; i < 40 && f; i += 1) {
				try {
					var pr = f.memoizedProps;
					if (pr) {
						// 只认带完整会话 node 的 props，避免蹭到父容器的 sessionId
						if (pr.node && typeof pr.node === "object" && typeof pr.node.id === "string" && pr.node.id) {
							return String(pr.node.id);
						}
						if (typeof pr.sessionId === "string" && pr.sessionId) return String(pr.sessionId);
					}
					// 记下会话行宿主节点的位置；再往上走 3 层就停（要把 SessionRow 组件的 props 读到）
					var sn = f.stateNode;
					if (rowAt < 0 && sn && typeof sn.className === "string" && sn.className.indexOf("sessionRow") >= 0) rowAt = i;
					if (rowAt >= 0 && i >= rowAt + 3) break;
				} catch (e) {}
				f = f.return;
			}
			return null;
		}

		function markOf(sid) {
			var m = markMap[sid] || {};
			var marks = m.marks || [];
			return {
				later: marks.indexOf("later") >= 0,
				favorite: marks.indexOf("favorite") >= 0,
				tags: (m.tags || []).slice(),
			};
		}

		function saveMark(sid, patch) {
			patch.sessionId = sid;
			return fetch(API + "/mark", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch),
			}).then(function (r) { return r.json(); }).then(function (j) {
				if (!j || !j.ok) throw new Error((j && j.error) || "save failed");
				if (j.session) markMap[sid] = j.session;
				else delete markMap[sid];
				render();
				paintHover(true);
				return j;
			});
		}

		/** 按 sessionId 反向找到侧栏里那一行；找不到返回 null。 */
		function rowElOf(sid) {
			var rows = document.querySelectorAll('[class*="sessionRow"]');
			for (var i = 0; i < rows.length; i += 1) {
				if (sessionIdOf(rows[i]) === sid) return rows[i];
			}
			return null;
		}

		function deleteMessage(j) {
			if (!j) return "未知错误";
			if (j.error === "has-subagents") return "这个会话有 " + (j.subagents || []).length + " 个子任务，先处理它们";
			if (j.error === "session-in-use") return "会话正在运行，先等它结束";
			if (j.error === "not-found") return "找不到这个会话";
			return j.message || j.error || "未知错误";
		}

		function deleteSession(sid, btn) {
			if (!window.confirm("删除这个会话？\n\n会话文件会被移进 ~/.dsh/sessions/.trash，界面上无法恢复。")) return;
			btn.disabled = true;
			btn.textContent = "删除中…";
			fetch(API + "/session-delete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: sid }),
			}).then(function (r) { return r.json(); }).then(function (j) {
				if (!j || !j.ok) throw new Error(deleteMessage(j));
				delete markMap[sid];
				var row = rowElOf(sid);
				var card = document.querySelector('[class*="_hoverContent"]');
				if (row && row.parentNode) row.parentNode.removeChild(row);
				if (card && card.parentNode) card.parentNode.removeChild(card);
				render();
			}).catch(function (error) {
				btn.disabled = false;
				btn.textContent = "删除";
				window.alert("删除失败：" + String((error && error.message) || error));
			});
		}

		function paintHover(force) {
			try {
				var card = document.querySelector('[class*="_hoverContent"]');
				if (!card) return;
				var sid = sessionIdOf(card);
				if (!sid) return;
				var old = card.querySelector("[" + HOVER_ATTR + "]");
				if (old && old.getAttribute(HOVER_ATTR) === sid && !force) return;
				if (old && old.parentNode) old.parentNode.removeChild(old);

				ensureHoverCss();
				var st = markOf(sid);
				var box = document.createElement("div");
				box.className = "dsm-actions";
				box.setAttribute(HOVER_ATTR, sid);

				function toggleBtn(label, on, key, field) {
					var b = document.createElement("button");
					b.type = "button";
					b.className = "dsm-act" + (on ? " is-on" : "");
					b.setAttribute("data-k", key);
					b.textContent = label;
					b.addEventListener("click", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						var patch = {};
						patch[field] = !on;
						saveMark(sid, patch).catch(function () {});
					});
					return b;
				}

				box.appendChild(toggleBtn("待回看", st.later, "reviewLater", "reviewLater"));
				box.appendChild(toggleBtn("收藏", st.favorite, "favorite", "favorite"));

				var input = document.createElement("input");
				input.className = "dsm-tag-input";
				input.type = "text";
				input.placeholder = st.tags.length ? st.tags.join(" / ") : "标签";
				var stop = function (ev) { ev.stopPropagation(); };
				input.addEventListener("pointerdown", stop);
				input.addEventListener("mousedown", stop);
				input.addEventListener("selectstart", stop);
				input.addEventListener("click", function (ev) { ev.stopPropagation(); });

				function addTag() {
					var raw = String(input.value || "").trim();
					if (!raw) {
						input.focus();
						return;
					}
					var tags = st.tags.slice();
					raw.split(/[,，、\s]+/).forEach(function (x) {
						if (x && tags.indexOf(x) < 0) tags.push(x);
					});
					input.value = "";
					saveMark(sid, { tags: tags }).catch(function () {
						input.value = raw;
						input.placeholder = "保存失败";
					});
				}

				input.addEventListener("keydown", function (ev) {
					ev.stopPropagation();
					if (ev.isComposing || ev.keyCode === 229) return;
					if (ev.key !== "Enter") return;
					ev.preventDefault();
					addTag();
				});
				// 打完字直接点走也算提交，免得只有回车一条路
				input.addEventListener("blur", function () {
					if (String(input.value || "").trim()) addTag();
				});
				box.appendChild(input);

				var addBtn = document.createElement("button");
				addBtn.type = "button";
				addBtn.className = "dsm-act";
				addBtn.textContent = "+";
				addBtn.title = "添加标签";
				addBtn.addEventListener("click", function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					addTag();
				});
				box.appendChild(addBtn);

				if (st.tags.length || st.later || st.favorite) {
					var clr = document.createElement("button");
					clr.type = "button";
					clr.className = "dsm-act";
					clr.textContent = "清除";
					clr.addEventListener("click", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						saveMark(sid, { reviewLater: false, favorite: false, tags: [] }).catch(function () {});
					});
					box.appendChild(clr);
				}

				var delBtn = document.createElement("button");
				delBtn.type = "button";
				delBtn.className = "dsm-act dsm-act-danger";
				delBtn.textContent = "删除";
				delBtn.addEventListener("click", function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					deleteSession(sid, delBtn);
				});
				box.appendChild(delBtn);

				card.appendChild(box);
			} catch (e) {}
		}

		function tick() {
			try {
				ensureCss();
				applyStyle();
				paintHover();
				loadMarks(function () {
					render();
				});
			} catch (e) {
			}
		}

		// DOM 一变就重画（节流 80ms），点不再等下一轮轮询
		function watchDom() {
			try {
				if (window.__dsmObserver) return;
				// 悬停卡片可能被 portal 到 body，所以观察整页；回调已节流 80ms
				var root = document.body
					|| document.querySelector("aside");
				if (!root) return;
				var timer = null;
				var mo = new MutationObserver(function () {
					if (rendering) return;
					if (timer) return;
					timer = setTimeout(function () {
						timer = null;
						if (!rendering) render();
						paintHover();
					}, 80);
				});
				mo.observe(root, { childList: true, subtree: true, characterData: true });
				window.__dsmObserver = mo;
			} catch (e) {
			}
		}

		var PORTS = [49397, 49398, 49399, 49400, 49401, 49402, 49403, 49404, 49405];

		/** 主控侧端口会顺延，先逐个问一遍，认 plugin 名对上才算自己的。 */
		function probeApi(done) {
			var i = 0;
			function next() {
				if (i >= PORTS.length) { done(false); return; }
				var base = "http://127.0.0.1:" + PORTS[i++];
				fetch(base + "/health").then(function (r) { return r.json(); }).then(function (j) {
					if (j && j.plugin === "dsh-sidebar-marks") { API = base; done(true); }
					else next();
				}).catch(next);
			}
			next();
		}

		function boot(ctx) {
			try {
				mar = { ctx: ctx || (mar && mar.ctx) || null };
			} catch (e) {}
			probeApi(function (ok) {
				if (!ok) {
					// 主控还没起来（DSH 前端可能先加载）：过会儿再试
					setTimeout(function () { boot(ctx); }, 3000);
					return;
				}
				try {
					if (window.__dsmMarksBooted) {
						// 热重载：只补一次，不重复挂定时器
						tick();
						return;
					}
					window.__dsmMarksBooted = true;
					setTimeout(function () { tick(); watchDom(); }, 1200);
					startStream();
					setInterval(tick, 6000);
					// 版本看门狗：host 侧改 ui.stamp 后，前端整页重载，绕过模块缓存
					setInterval(function () {
						try {
							fetch(API + "/health").then(function (r) { return r.json(); }).then(function (j) {
								var v = String((j && j.ui) || "1");
								if (!window.__dsmUiSeen) { window.__dsmUiSeen = v; return; }
								if (v !== window.__dsmUiSeen) {
									window.__dsmUiSeen = v;
									location.reload();
								}
							}).catch(function () {});
						} catch (e) {}
					}, 4000);
				} catch (err) {}
			});
		}

		function apply(ctx) {
			try { boot(ctx); } catch (err) {}
		}

		exports.apply = apply;
		exports.inject = ["slots", "sessions"];

		// 不依赖 Cordis 生命周期：factory 执行即启动，热重载也能立刻反映
		try { boot(null); } catch (err) {}

		return module.exports;
	},
});
