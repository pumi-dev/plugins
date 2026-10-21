//! Where a diagram's nodes are: read from the SVG Pele draws (`<g class="pele-node …"
//! data-id="ask" transform="translate(x,y)">` around a shape and its label), in the diagram's
//! own points, so a click on the picture can say which node it was.

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    /// Its Mermaid id (`ask`).
    pub id: String,
    /// What it says.
    pub label: String,
    /// Its box, from the diagram's top left corner, in the diagram's points.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Node {
    fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let at = tag.find(&key)? + key.len();
    let end = tag[at..].find('"')?;
    Some(&tag[at..at + end])
}

fn num(tag: &str, name: &str) -> Option<f32> {
    attr(tag, name)?.trim_end_matches("px").parse().ok()
}

fn translate(tag: &str) -> (f32, f32) {
    let Some(t) = attr(tag, "transform") else { return (0., 0.) };
    let Some(inner) = t.strip_prefix("translate(").and_then(|r| r.split(')').next()) else { return (0., 0.) };
    let mut parts = inner.split([',', ' ']).filter(|p| !p.is_empty()).map(|p| p.parse::<f32>().unwrap_or(0.));
    (parts.next().unwrap_or(0.), parts.next().unwrap_or(0.))
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

/// The text inside every `<text>` of `body`, its tags dropped.
fn label(body: &str) -> String {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("<text") {
        let Some(open) = rest[start..].find('>') else { break };
        let from = start + open + 1;
        let Some(close) = rest[from..].find("</text>") else { break };
        let inner = &rest[from..from + close];
        let mut plain = String::new();
        let mut in_tag = false;
        for c in inner.chars() {
            match c {
                '<' => in_tag = true,
                '>' => in_tag = false,
                c if !in_tag => plain.push(c),
                _ => {}
            }
        }
        let plain = unescape(plain.trim());
        if !plain.is_empty() {
            out.push(plain);
        }
        rest = &rest[from + close..];
    }
    out.join(" ")
}

/// The shape's box, around the node's own origin.
fn shape(body: &str) -> Option<(f32, f32, f32, f32)> {
    let first = ["<rect ", "<circle ", "<ellipse ", "<polygon ", "<path "]
        .iter()
        .filter_map(|t| body.find(t).map(|at| (at, *t)))
        .min_by_key(|(at, _)| *at)?;
    let tag = &body[first.0..first.0 + body[first.0..].find('>')?];
    match first.1 {
        "<rect " => Some((num(tag, "x").unwrap_or(0.), num(tag, "y").unwrap_or(0.), num(tag, "width")?, num(tag, "height")?)),
        "<circle " => {
            let r = num(tag, "r")?;
            Some((num(tag, "cx").unwrap_or(0.) - r, num(tag, "cy").unwrap_or(0.) - r, r * 2., r * 2.))
        }
        "<ellipse " => {
            let (rx, ry) = (num(tag, "rx")?, num(tag, "ry")?);
            Some((num(tag, "cx").unwrap_or(0.) - rx, num(tag, "cy").unwrap_or(0.) - ry, rx * 2., ry * 2.))
        }
        "<polygon " => {
            let points: Vec<f32> =
                attr(tag, "points")?.split([',', ' ']).filter(|p| !p.is_empty()).filter_map(|p| p.parse().ok()).collect();
            let xs: Vec<f32> = points.iter().step_by(2).copied().collect();
            let ys: Vec<f32> = points.iter().skip(1).step_by(2).copied().collect();
            let (x0, x1) = (xs.iter().copied().fold(f32::MAX, f32::min), xs.iter().copied().fold(f32::MIN, f32::max));
            let (y0, y1) = (ys.iter().copied().fold(f32::MAX, f32::min), ys.iter().copied().fold(f32::MIN, f32::max));
            (x1 > x0 && y1 > y0).then_some((x0, y0, x1 - x0, y1 - y0))
        }
        _ => None,
    }
}

/// Every node Pele drew, in the order it drew them.
pub fn nodes(svg: &str) -> Vec<Node> {
    const MARK: &str = "<g class=\"pele-node";
    let starts: Vec<usize> = svg.match_indices(MARK).map(|(at, _)| at).collect();
    let mut out = Vec::new();
    for (i, &start) in starts.iter().enumerate() {
        let Some(tag_end) = svg[start..].find('>').map(|e| start + e) else { continue };
        let tag = &svg[start..tag_end];
        let Some(id) = attr(tag, "data-id") else { continue };
        let end = starts.get(i + 1).copied().unwrap_or(svg.len());
        let body = &svg[tag_end..end];
        let (tx, ty) = translate(tag);
        let (x, y, w, h) = shape(body).unwrap_or((-20., -12., 40., 24.));
        out.push(Node { id: unescape(id), label: label(body), x: tx + x, y: ty + y, w, h });
    }
    out
}

/// The node at a point of the diagram: the smallest whose box holds it.
pub fn at(nodes: &[Node], x: f32, y: f32) -> Option<usize> {
    nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.contains(x, y))
        .min_by(|(_, a), (_, b)| (a.w * a.h).total_cmp(&(b.w * b.h)))
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SVG: &str = r##"<svg viewBox="0 0 342 64"><g class="pele-edges"><g class="pele-edge" data-id="L_ask_draw_0"><path d="M131,32L172,32"/></g></g><g class="pele-nodes"><g class="pele-node pele-shape-rect" data-id="ask" transform="translate(69.58,32)"><rect x="-61.58" y="-24" width="123.17" height="48" fill="#f3f3f3" style="rx:4px"/><text class="pele-label" x="0" y="5.6">the <tspan>question</tspan></text></g><g class="pele-node pele-shape-circle" data-id="end" transform="translate(300,32)"><circle cx="0" cy="0" r="20"/><text>a &amp; b</text></g></g></svg>"##;

    #[test]
    fn nodes_are_where_pele_drew_them() {
        let found = nodes(SVG);
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].id.as_str(), found[0].label.as_str()), ("ask", "the question"));
        assert!((found[0].x - 8.).abs() < 0.01 && (found[0].y - 8.).abs() < 0.01);
        assert_eq!((found[1].label.as_str(), found[1].w), ("a & b", 40.));
        assert_eq!(at(&found, 70., 30.), Some(0));
        assert_eq!(at(&found, 300., 40.), Some(1));
        assert_eq!(at(&found, 160., 32.), None, "an edge is not a node");
    }
}
