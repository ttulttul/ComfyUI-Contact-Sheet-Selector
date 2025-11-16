from .node import ContactSheetExtension, ContactSheetSelector, comfy_entrypoint

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "ContactSheetSelector": ContactSheetSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ContactSheetSelector": "Contact Sheet Selector",
}

__all__ = [
    "ContactSheetSelector",
    "ContactSheetExtension",
    "WEB_DIRECTORY",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "comfy_entrypoint",
]
