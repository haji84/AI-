export type KnowledgeNodeType="Person"|"Organization"|"Project"|"File"|"Rule"|"Decision"|"Deadline"|"Task"|"Dependency"|"Evidence"|"System"|"Asset";
export type KnowledgeNode={id:string;type:KnowledgeNodeType;label:string;properties?:Record<string,unknown>};
export type KnowledgeEdge={from:string;to:string;type:string;properties?:Record<string,unknown>};
export class JarvisKnowledgeGraph {
  private nodes=new Map<string,KnowledgeNode>(); private edges:KnowledgeEdge[]=[];
  upsertNode(node:KnowledgeNode){this.nodes.set(node.id,structuredClone(node));}
  link(edge:KnowledgeEdge){if(!this.nodes.has(edge.from)||!this.nodes.has(edge.to))throw new Error("knowledge edge requires existing nodes");this.edges.push(structuredClone(edge));}
  neighbors(id:string,type?:string){return this.edges.filter(e=>(e.from===id||e.to===id)&&(!type||e.type===type)).map(e=>({edge:e,node:this.nodes.get(e.from===id?e.to:e.from)!}));}
  impact(startId:string,maxDepth=5){const seen=new Set([startId]);let frontier=[startId];for(let d=0;d<maxDepth;d++){const next:string[]=[];for(const id of frontier){for(const {node} of this.neighbors(id)){if(!seen.has(node.id)){seen.add(node.id);next.push(node.id);}}}frontier=next;if(!frontier.length)break;}return [...seen].map(id=>this.nodes.get(id)).filter(Boolean);}
  dependencyOrder(taskIds:string[]){const set=new Set(taskIds),out:string[]=[],temp=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(done.has(id))return;if(temp.has(id))throw new Error("dependency cycle");temp.add(id);for(const e of this.edges.filter(e=>e.to===id&&e.type==="DEPENDS_ON"&&set.has(e.from)))visit(e.from);temp.delete(id);done.add(id);out.push(id);};taskIds.forEach(visit);return out;}
  snapshot(){return {nodes:[...this.nodes.values()],edges:[...this.edges]};}
}
