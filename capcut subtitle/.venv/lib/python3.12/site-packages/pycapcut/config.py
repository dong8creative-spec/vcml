import os

from typing import Optional

class Config:
    """全局配置管理类"""

    _cache_path: Optional[str] = None
    """CapCut缓存路径"""
    _draft_path: Optional[str] = None
    """CapCut草稿文件夹"""

    @classmethod
    def set_cache_path(cls, path: Optional[str] = None) -> None:
        """设置CapCut缓存路径, 若不指定则尝试在用户目录下寻找

        Args:
            path (str, optional): 缓存路径, 通常形如 `.../CapCut/User Data/Cache`

        Raises:
            FileNotFoundError: 缓存路径不存在或未能在默认位置找到
        """
        if path is None:
            local_path = os.getenv('LOCALAPPDATA')
            assert local_path is not None, "未能找到LOCALAPPDATA环境变量"

            path = os.path.join(local_path, 'CapCut', 'User Data', 'Cache')
            if not os.path.exists(path):
                raise FileNotFoundError(f"尝试自动定位缓存路径失败: {path}, 请手动指定路径")
        elif not os.path.exists(path):
            raise FileNotFoundError(f"未能找到缓存路径: {path}")

        cls._cache_path = path

    @classmethod
    def set_draft_path(cls, path: str) -> None:
        """设置CapCut草稿文件夹

        Args:
            path (str): 草稿文件夹路径, 通常形如 `.../CapCut Drafts`

        Raises:
            FileNotFoundError: 给定的路径不存在
        """
        if not os.path.exists(path):
            raise FileNotFoundError(f"未能找到草稿文件夹: {path}")
        cls._draft_path = path

    @classmethod
    def cache_path(cls, *, allow_empty: bool = False) -> str:
        """获取CapCut缓存路径"""
        if allow_empty:
            return os.path.join((cls._cache_path or "C:"), "effect")

        if cls._cache_path is None:
            cls.set_cache_path()
        assert cls._cache_path is not None

        return os.path.join(cls._cache_path, "effect")

    @classmethod
    def draft_path(cls, *, allow_empty: bool = False) -> str:
        """获取CapCut草稿文件夹路径"""
        if allow_empty:
            return cls._draft_path or ""
        if cls._draft_path is None:
            raise ValueError("未设置草稿文件夹路径")

        return cls._draft_path
