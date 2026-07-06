import asyncio
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import get_session
from app.routers._common import get_connection_or_404
from app.services.db_service import db_service
from app.services.migration_service import migration_service
from app.services.migration_plan_service import migration_plan_service
from app.services.migration_executor import migration_executor, job_registry

router = APIRouter()


class DiffRequest(BaseModel):
    user_anon_id: str
    source_connection_id: str
    target_connection_id: str
    schema: Optional[str] = None


class ScriptRequest(DiffRequest):
    dialect: str = "postgresql"


@router.post("/diff")
async def schema_diff(
    body: DiffRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        return migration_service.diff(source, target, body.schema)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/script")
async def migration_script(
    body: ScriptRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        sql = migration_service.generate_migration_sql(source, target, body.schema, body.dialect)
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class ObjectsRequest(BaseModel):
    user_anon_id: str
    source_connection_id: str
    target_connection_id: str
    schema: Optional[str] = None


class PlanRequest(ObjectsRequest):
    object_names: List[str]
    scope: Literal["schema", "schema_data"] = "schema"


class ObjectExecSpec(BaseModel):
    name: str
    status: str
    include: bool = True
    version_instead_of_overwrite: bool = False


class ExecuteRequest(ObjectsRequest):
    objects: List[ObjectExecSpec]
    scope: Literal["schema", "schema_data"] = "schema"


@router.post("/objects")
async def migration_objects(
    body: ObjectsRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        return await db_service.run_off_loop(migration_plan_service.list_objects, source, target, body.schema)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/plan")
async def migration_plan(
    body: PlanRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        return await db_service.run_off_loop(
            migration_plan_service.build_plan, source, target, body.object_names, body.scope, body.schema,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/execute")
async def migration_execute(
    body: ExecuteRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        object_specs = [o.model_dump() for o in body.objects]
        job = await db_service.run_off_loop(
            migration_executor.prepare_job, source, target, object_specs, body.scope, body.schema, body.user_anon_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    asyncio.create_task(migration_executor.run(job))
    return job_registry.serialize(job)


@router.get("/jobs/{job_id}")
async def migration_job_status(
    job_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(user_anon_id, session)
    job = job_registry.get(job_id)
    if not job or job.user_id != user_anon_id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job_registry.serialize(job)
