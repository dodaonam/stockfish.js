class BridgeError(Exception):
    code = "INTERNAL"
    status_code = 500

    def __init__(self, message: str = "Internal error") -> None:
        super().__init__(message)
        self.message = message


class InvalidRequestError(BridgeError):
    code = "INVALID_REQUEST"
    status_code = 400


class InvalidFenError(BridgeError):
    code = "INVALID_FEN"
    status_code = 400


class EngineNotReadyError(BridgeError):
    code = "ENGINE_NOT_READY"
    status_code = 503


class EngineTimeoutError(BridgeError):
    code = "ENGINE_TIMEOUT"
    status_code = 504


class EngineCrashedError(BridgeError):
    code = "ENGINE_CRASHED"
    status_code = 503


class SupersededError(BridgeError):
    code = "SUPERSEDED"
    status_code = 409


class UnauthorizedError(BridgeError):
    code = "UNAUTHORIZED"
    status_code = 401
