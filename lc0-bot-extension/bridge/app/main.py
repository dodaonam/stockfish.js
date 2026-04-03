import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .engine import EngineManager
from .errors import BridgeError, UnauthorizedError
from .schemas import BestMoveError, BestMoveRequest, BestMoveSuccess, HealthResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_settings()
engine_manager = EngineManager(settings)


async def validate_token(x_api_token: str | None = Header(default=None, alias="X-Api-Token")) -> None:
    if settings.lc0_api_token and x_api_token != settings.lc0_api_token:
        raise UnauthorizedError("Invalid API token")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await engine_manager.startup()
    yield
    await engine_manager.shutdown()


app = FastAPI(title="lc0 local bridge", version="1.0.0", lifespan=lifespan)


@app.exception_handler(BridgeError)
async def bridge_error_handler(_: Request, exc: BridgeError):
    payload = BestMoveError(
        request_id="",
        code=exc.code,
        message=exc.message,
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    code = "INVALID_REQUEST"
    for err in exc.errors():
        loc = err.get("loc", ())
        if "fen" in loc:
            code = "INVALID_FEN"
            break

    payload = BestMoveError(
        request_id="",
        code=code,
        message=str(exc),
    )
    return JSONResponse(status_code=400, content=payload.model_dump())


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        ready=engine_manager.ready,
        pid=engine_manager.pid,
        uptime_sec=engine_manager.uptime_sec,
        active_mode=engine_manager.active_mode,
        last_error=engine_manager.last_error,
    )


@app.post("/v1/bestmove", response_model=BestMoveSuccess | BestMoveError)
async def bestmove(request: BestMoveRequest, _: None = Depends(validate_token)):
    try:
        result = await engine_manager.get_bestmove(
            request_id=request.request_id,
            fen=request.fen,
            movetime_s=request.movetime_s,
            search_mode=request.search_mode,
        )
        return BestMoveSuccess(
            request_id=request.request_id,
            bestmove=result.bestmove,
            ponder=result.ponder,
            fen_echo=request.fen,
            elapsed_ms=result.elapsed_ms,
            search_mode=request.search_mode,
        )
    except BridgeError as exc:
        payload = BestMoveError(
            request_id=request.request_id,
            code=exc.code,
            message=exc.message,
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())
    except Exception as exc:  # pragma: no cover
        payload = BestMoveError(
            request_id=request.request_id,
            code="INTERNAL",
            message=str(exc),
        )
        return JSONResponse(status_code=500, content=payload.model_dump())
